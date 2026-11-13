import type {
  LiveSession,
  LiveSessionMachine,
  LiveSessionRegistryEvent,
  LiveSessionRegistrySnapshot
} from '../../shared/live-sessions/live-session-types'
import type { LiveSessionHost } from './hosts/live-session-hosts'
import { HostSessionScanner, scanLimitsFor } from './discovery/host-session-scanner'
import { mergeSealPanes, type SealPane } from './seal-panes/seal-pane-sessions'

export type LiveSessionRegistryDeps = {
  localMachine: LiveSessionMachine
  /** Every host to scan right now (this machine, connected SSH targets and paired servers). */
  hosts: () => LiveSessionHost[]
  sealPanes: () => SealPane[]
  /** Pane changes come between scans; the registry republishes on each. */
  subscribeSealPanes?: (onChange: () => void) => () => void
  /** Sessions the user removed from Seal; never published. */
  isRemoved?: (session: LiveSession) => boolean
  onHostScanned?: (host: LiveSessionHost, sessions: LiveSession[]) => void
  now?: () => number
  intervalsMs?: { local: number; ssh: number }
  log?: (message: string, error?: unknown) => void
}

type HostState = {
  host: LiveSessionHost
  scanner: HostSessionScanner
  sessions: LiveSession[]
  nextScanAt: number
  scanning: boolean
  /** Scans in a row that found nothing new; each stretches the wait, up to MAX_IDLE_STRETCH. */
  idleScans: number
  failures: number
}

/** New SSH connections are picked up within this. */
const HOST_SYNC_MS = 5_000
const MAX_IDLE_STRETCH = 2
const MAX_FAILURE_STRETCH = 4

/**
 * Every Claude Code and Codex session on every connected machine, whether Seal started it or not.
 * Consumers read `getSnapshot()` once, then apply `subscribe()` events in revision order.
 */
export class LiveSessionRegistry {
  private readonly hosts = new Map<string, HostState>()
  private readonly published = new Map<string, { session: LiveSession; json: string }>()
  private readonly hostErrors = new Map<string, string>()
  /** Ids a session had before its transcript named it: a fresh agent is `pid-<pid>` until its first prompt. */
  private readonly renamed = new Map<string, string>()
  private readonly listeners = new Set<(event: LiveSessionRegistryEvent) => void>()
  private revision = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private releaseSealPanes: (() => void) | null = null
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
    this.releaseSealPanes = this.deps.subscribeSealPanes?.(() => this.publish()) ?? null
    this.tick()
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = null
    this.releaseSealPanes?.()
    this.releaseSealPanes = null
  }

  getSnapshot(): LiveSessionRegistrySnapshot {
    return {
      revision: this.revision,
      sessions: [...this.published.values()]
        .map((p) => p.session)
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt),
      hostErrors: Object.fromEntries(this.hostErrors)
    }
  }

  get(sessionId: string): LiveSession | null {
    return this.published.get(this.currentId(sessionId))?.session ?? null
  }

  /** The id a session goes by now, following its renames. */
  currentId(sessionId: string): string {
    let id = sessionId
    for (let hops = 0; hops < 8 && this.renamed.has(id); hops++) {
      id = this.renamed.get(id)!
    }
    return id
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
      if (!state.scanning && now >= state.nextScanAt) {
        void this.scanHost(state)
      }
    }
    this.schedule()
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
        this.hostErrors.delete(hostId)
        changed = true
      } else {
        state.host = host
      }
    }
    for (const [hostId, host] of current) {
      if (!this.hosts.has(hostId)) {
        this.hosts.set(hostId, {
          host,
          scanner: new HostSessionScanner(
            {
              machine: host.machine,
              run: (script, options) => this.hosts.get(hostId)!.host.run(script, options),
              transcriptFiles: host.transcriptFiles
            },
            scanLimitsFor(host.machine)
          ),
          sessions: [],
          nextScanAt: 0,
          scanning: false,
          idleScans: 0,
          failures: 0
        })
      }
    }
    if (changed) {
      this.publish()
    }
  }

  private async scanHost(state: HostState): Promise<void> {
    if (state.scanning) {
      return
    }
    state.scanning = true
    const hostId = state.host.machine.hostId
    try {
      const result = await state.scanner.scan(this.now())
      if (this.hosts.get(hostId) !== state) {
        return
      }
      if (result.complete || result.sessions.length >= state.sessions.length) {
        const unchanged = JSON.stringify(result.sessions) === JSON.stringify(state.sessions)
        state.idleScans = unchanged ? state.idleScans + 1 : 0
        state.sessions = result.sessions
      }
      state.failures = 0
      this.deps.onHostScanned?.(state.host, state.sessions)
      this.setHostError(hostId, result.complete ? null : 'The scan was cut short')
      this.publish()
    } catch (error) {
      state.failures++
      this.deps.log?.(`[live-sessions] scan of ${hostId} failed`, error)
      this.setHostError(hostId, error instanceof Error ? error.message : String(error))
    } finally {
      state.scanning = false
      const base = state.host.machine.kind === 'local' ? this.intervals.local : this.intervals.ssh
      const stretch =
        state.failures > 0
          ? 2 ** Math.min(state.failures, MAX_FAILURE_STRETCH)
          : 2 ** Math.min(state.idleScans, MAX_IDLE_STRETCH)
      state.nextScanAt = this.now() + base * stretch
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

  private publish(): void {
    const discovered = [...this.hosts.values()].flatMap((s) => s.sessions)
    const merged = mergeSealPanes(discovered, this.deps.sealPanes(), this.deps.localMachine).filter(
      (session) => !this.deps.isRemoved?.(session)
    )
    const seen = new Set<string>()
    for (const session of merged) {
      if (seen.has(session.id)) {
        continue
      }
      seen.add(session.id)
      const json = JSON.stringify(session)
      if (this.published.get(session.id)?.json === json) {
        continue
      }
      this.published.set(session.id, { session, json })
      this.emit({ type: 'upsert', revision: ++this.revision, session })
    }
    for (const [sessionId, { session: gone }] of this.published) {
      if (seen.has(sessionId)) {
        continue
      }
      this.published.delete(sessionId)
      const successor =
        gone.pid !== null && gone.providerSessionId.startsWith('pid-')
          ? merged.find(
              (s) =>
                s.pid === gone.pid &&
                s.machine.hostId === gone.machine.hostId &&
                s.provider === gone.provider
            )
          : undefined
      if (successor) {
        this.renamed.set(sessionId, successor.id)
      }
      this.emit({
        type: 'remove',
        revision: ++this.revision,
        sessionId,
        ...(successor ? { replacedBy: successor.id } : {})
      })
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
