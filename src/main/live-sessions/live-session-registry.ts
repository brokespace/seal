import type {
  LiveSession,
  LiveSessionMachine,
  LiveSessionRegistryEvent,
  LiveSessionRegistrySnapshot
} from '../../shared/live-sessions/live-session-types'
import type { LiveSessionHost } from './hosts/live-session-hosts'
import type { SealPane } from './seal-panes/seal-pane-sessions'
import type { LiveSessionSource } from './sources/live-session-source'
import { mergeSessionSources } from './sources/session-source-merge'
import { PublishedSessions } from './sources/published-sessions'
import { LiveSessionStatusHold } from './live-session-status-hold'
import {
  type HostScanState,
  newHostScanState,
  nextScanDelayMs,
  SealPaneStatusChanges
} from './live-session-host-scan-state'
import { errorMessage } from '../../shared/error-message'

export type LiveSessionRegistryDeps = {
  localMachine: LiveSessionMachine
  /** Every host to scan right now (this machine, connected SSH targets and paired servers). */
  hosts: () => LiveSessionHost[]
  sealPanes: () => SealPane[]
  /** Pane changes come between scans; the registry republishes on each. */
  subscribeSealPanes?: (onChange: () => void) => () => void
  /**
   * Has the pane's host check its agent process. A killed agent fires no hook, so its pane would
   * keep its last status; the host drops the pane's row once it finds the process gone.
   */
  confirmSealPaneAgent?: (paneKey: string) => void
  /** This machine's chats, as their structured host reports them. */
  chats?: LiveSessionSource
  /** Paired servers whose own registries list their machines' sessions. */
  federation?: {
    source: LiveSessionSource
    /** The machine's sessions come from its server: it is not scanned from here. */
    covers(hostId: string): boolean
    /** What the machine's row says while its server cannot list everything. */
    notice(hostId: string): string | null
  }
  /** Sessions the user removed from Seal; never published. */
  isRemoved?: (session: LiveSession) => boolean
  /** Adds what the user set on a session in Seal (its name, its pin). */
  annotate?: (session: LiveSession) => LiveSession
  onHostScanned?: (host: LiveSessionHost, sessions: LiveSession[]) => void
  now?: () => number
  intervalsMs?: { local: number; ssh: number }
  log?: (message: string, error?: unknown) => void
}

/** New SSH connections are picked up within this. */
const HOST_SYNC_MS = 5_000
/** A machine that failed this many scans in a row no longer vouches for what its sessions do. */
const UNREACHABLE_AFTER_FAILURES = 3

/**
 * Every agent session on every connected machine: chats, agents in Seal's panes and agents started
 * outside Seal. Consumers read `getSnapshot()` once, then apply `subscribe()` events in revision order.
 */
export class LiveSessionRegistry {
  private readonly hosts = new Map<string, HostScanState>()
  private readonly published = new PublishedSessions()
  private readonly hostErrors = new Map<string, string>()
  private readonly listeners = new Set<(event: LiveSessionRegistryEvent) => void>()
  private revision = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private releaseSources: (() => void)[] = []
  private decorator: ((session: LiveSession) => LiveSession) | null = null
  /** Released by whoever stops a session for the user. */
  readonly statusHold = new LiveSessionStatusHold()
  private readonly paneStatuses = new SealPaneStatusChanges()
  private readonly now: () => number
  private readonly intervals: { local: number; ssh: number }

  constructor(private readonly deps: LiveSessionRegistryDeps) {
    this.now = deps.now ?? Date.now
    this.intervals = deps.intervalsMs ?? { local: 3_000, ssh: 8_000 }
  }

  start(): void {
    if (this.running) {
      return
    }
    this.running = true
    const republish = (): void => this.publish()
    this.releaseSources = [
      this.deps.subscribeSealPanes?.(() => this.onSealPanesChanged()),
      this.deps.chats?.subscribe(republish),
      this.deps.federation?.source.subscribe(republish)
    ].filter((release) => release !== undefined)
    this.tick()
  }

  private onSealPanesChanged(): void {
    const changed = this.paneStatuses.mark(this.deps.sealPanes(), this.hosts.values(), this.now())
    this.publish()
    if (changed) {
      this.schedule()
    }
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = null
    for (const release of this.releaseSources.splice(0)) {
      release()
    }
  }

  getSnapshot(): LiveSessionRegistrySnapshot {
    return {
      revision: this.revision,
      sessions: this.published.list().sort((a, b) => b.lastActivityAt - a.lastActivityAt),
      hostErrors: Object.fromEntries(this.hostErrors)
    }
  }

  get(sessionId: string): LiveSession | null {
    return this.published.get(sessionId)
  }

  /** Seal resumed a closed session headless as `pid`: the transcript's fresh writes are its own. */
  noteResumed(session: LiveSession, pid: number): void {
    if (session.transcriptPath) {
      this.hosts.get(session.machine.hostId)?.scanner.noteResumed(session.transcriptPath, pid)
    }
  }

  /** Whether the session's machine has answered or given up since Seal started; until then a session not listed may still be running. */
  hasRead(sessionId: string): boolean {
    return [...this.hosts].some(
      ([hostId, state]) =>
        sessionId.startsWith(`${hostId}:`) &&
        (state.read || state.failures >= UNREACHABLE_AFTER_FAILURES || this.federated(state))
    )
  }

  /** The id a session goes by now, following its renames. */
  currentId(sessionId: string): string {
    return this.published.currentId(sessionId)
  }

  host(hostId: string): LiveSessionHost | null {
    return this.hosts.get(hostId)?.host ?? null
  }

  subscribe(listener: (event: LiveSessionRegistryEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Scan every host now (after a send, or when a view opens). */
  async refresh(hostId?: string): Promise<void> {
    this.syncHosts()
    await Promise.all(
      [...this.hosts.values()]
        .filter((state) => !hostId || state.host.machine.hostId === hostId)
        .filter((state) => !this.federated(state))
        .map((state) => {
          state.idleScans = 0
          return this.scanHost(state)
        })
    )
  }

  private tick(): void {
    this.timer = null
    this.syncHosts()
    const now = this.now()
    for (const state of this.hosts.values()) {
      if (state.scanning || now < state.nextScanAt) {
        continue
      }
      if (this.federated(state)) {
        // Not scanned, so nothing else moves its due time: left in the past it would wake this at once, forever.
        state.nextScanAt = now + HOST_SYNC_MS
      } else {
        void this.scanHost(state)
      }
    }
    this.schedule()
  }

  /** A machine whose server lists its sessions itself: what a scan of it read no longer stands. */
  private federated(state: HostScanState): boolean {
    if (!this.deps.federation?.covers(state.host.machine.hostId)) {
      return false
    }
    state.sessions = []
    return true
  }

  /** Wake for the next host due, or the next host sync, whichever comes first. */
  private schedule(): void {
    if (!this.running) {
      return
    }
    if (this.timer) {
      clearTimeout(this.timer)
    }
    const now = this.now()
    let wakeAt = now + HOST_SYNC_MS
    for (const state of this.hosts.values()) {
      if (!state.scanning) {
        wakeAt = Math.min(wakeAt, state.nextScanAt)
      }
    }
    this.timer = setTimeout(() => this.tick(), Math.max(0, wakeAt - now))
    this.timer.unref?.()
  }

  private syncHosts(): void {
    const current = new Map(this.deps.hosts().map((h) => [h.machine.hostId, h]))
    let changed = false
    for (const [hostId, state] of this.hosts) {
      const host = current.get(hostId)
      if (!host) {
        this.hosts.delete(hostId)
        this.setHostError(hostId, null)
        changed = true
      } else {
        state.host = host
      }
    }
    for (const [hostId, host] of current) {
      if (!this.hosts.has(hostId)) {
        this.hosts.set(
          hostId,
          newHostScanState(host, () => this.hosts.get(hostId)!.host)
        )
      }
    }
    if (changed) {
      this.publish()
    }
  }

  private async scanHost(state: HostScanState): Promise<void> {
    if (state.scanning) {
      return
    }
    state.scanning = true
    state.paneChanged = false
    const hostId = state.host.machine.hostId
    try {
      const result = await state.scanner.scan(this.now())
      if (this.hosts.get(hostId) !== state) {
        return
      }
      // A scan that broke off before the process list would show every agent as gone.
      const told = result.complete || result.processesListed
      if (told && (result.complete || result.sessions.length >= state.sessions.length)) {
        const unchanged = JSON.stringify(result.sessions) === JSON.stringify(state.sessions)
        state.idleScans = unchanged ? state.idleScans + 1 : 0
        state.sessions = result.sessions
      }
      // Cut short after the process list, it names no agent whose transcript it did not reach.
      state.read ||= result.complete
      state.scans++
      state.failures = 0
      this.deps.onHostScanned?.(state.host, state.sessions)
      this.setHostError(
        hostId,
        result.complete ? (this.deps.federation?.notice(hostId) ?? null) : 'The scan was cut short'
      )
      this.publish()
    } catch (error) {
      state.failures++
      this.deps.log?.(`[live-sessions] scan of ${hostId} failed`, error)
      this.setHostError(hostId, errorMessage(error))
      // Its sessions' last statuses would stand for as long as it stays silent; they leave the
      // list as they do when it disconnects, and its error stays to say why.
      if (state.failures === UNREACHABLE_AFTER_FAILURES && state.sessions.length > 0) {
        state.sessions = []
        this.publish()
      }
    } finally {
      state.scanning = false
      state.nextScanAt = this.now() + nextScanDelayMs(state, this.intervals)
      this.schedule()
    }
  }

  private setHostError(hostId: string, error: string | null): void {
    if ((this.hostErrors.get(hostId) ?? null) === error) {
      return
    }
    if (error === null) {
      this.hostErrors.delete(hostId)
    } else {
      this.hostErrors.set(hostId, error)
    }
    this.emit({ type: 'host-error', revision: ++this.revision, hostId, error })
  }

  republish(): void {
    this.publish()
  }

  /** Adds what another feature knows about a session (its status summary) before it is published. */
  setDecorator(decorator: ((session: LiveSession) => LiveSession) | null): void {
    this.decorator = decorator
    this.publish()
  }

  private publish(): void {
    const scanned = [...this.hosts.values()].filter((state) => !this.federated(state))
    const decorate = this.decorator
    const now = this.now()
    const local = mergeSessionSources({
      discovered: scanned.flatMap((state) => state.sessions),
      panes: this.deps.sealPanes(),
      chats: this.deps.chats?.sessions() ?? [],
      localMachine: this.deps.localMachine,
      onUnseenAgent: this.deps.confirmSealPaneAgent
    }).map((session) =>
      this.statusHold.settle(session, this.hosts.get(session.machine.hostId)?.scans ?? 0, now)
    )
    // A server's records were settled by its own registry.
    const merged = [...local, ...(this.deps.federation?.source.sessions() ?? [])]
      .filter((session) => !this.deps.isRemoved?.(session))
      .map((session) => this.deps.annotate?.(session) ?? session)
      .map((session) => (decorate ? decorate(session) : session))
    this.publishFederationNotices()
    this.statusHold.keep(new Set(merged.map((session) => session.id)))
    for (const change of this.published.replace(merged)) {
      this.emit({ ...change, revision: ++this.revision })
    }
  }

  private publishFederationNotices(): void {
    const federation = this.deps.federation
    if (!federation) {
      return
    }
    for (const hostId of this.hosts.keys()) {
      if (federation.covers(hostId)) {
        this.setHostError(hostId, federation.notice(hostId))
      }
    }
  }

  private emit(event: LiveSessionRegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        this.deps.log?.('[live-sessions] listener threw', error)
      }
    }
  }
}
