import type {
  LiveSession,
  LiveSessionMachine,
  LiveSessionRegistryEvent,
  LiveSessionRegistrySnapshot
} from '../../shared/live-sessions/live-session-types'
import type { LiveSessionHost } from './hosts/live-session-hosts'
import {
  HostSessionScanner,
  LOCAL_SCAN_LIMITS,
  SSH_SCAN_LIMITS
} from './discovery/host-session-scanner'
import { mergeSealPanes, type SealPane } from './seal-panes/seal-pane-sessions'

export type LiveSessionRegistryDeps = {
  localMachine: LiveSessionMachine
  /** Every host to scan right now (this machine and connected SSH targets). */
  hosts: () => LiveSessionHost[]
  sealPanes: () => SealPane[]
  /** Pane changes come between scans; the registry republishes on each. */
  subscribeSealPanes?: (onChange: () => void) => () => void
  /** Extra transcript roots for a host (account profiles); defaults are found on the host. */
  extraRoots?: (hostId: string) => { claudeProjectsDirs: string[]; codexSessionsDirs: string[] }
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
}

const TICK_MS = 1_000

/**
 * Every Claude Code and Codex session on every connected machine, whether Seal started it or not.
 * Consumers read `getSnapshot()` once, then apply `subscribe()` events in revision order.
 */
export class LiveSessionRegistry {
  private readonly hosts = new Map<string, HostState>()
  private readonly published = new Map<string, { session: LiveSession; json: string }>()
  private readonly hostErrors = new Map<string, string>()
  private readonly listeners = new Set<(event: LiveSessionRegistryEvent) => void>()
  private revision = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private releaseSealPanes: (() => void) | null = null
  private readonly now: () => number
  private readonly intervals: { local: number; ssh: number }

  constructor(private readonly deps: LiveSessionRegistryDeps) {
    this.now = deps.now ?? Date.now
    this.intervals = deps.intervalsMs ?? { local: 3_000, ssh: 8_000 }
  }

  start(): void {
    if (this.timer) {
      return
    }
    this.releaseSealPanes = this.deps.subscribeSealPanes?.(() => this.publish()) ?? null
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.timer.unref?.()
    this.tick()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
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
    return this.published.get(sessionId)?.session ?? null
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
        .map((state) => this.scanHost(state))
    )
  }

  private tick(): void {
    this.syncHosts()
    const now = this.now()
    for (const state of this.hosts.values()) {
      if (!state.scanning && now >= state.nextScanAt) {
        void this.scanHost(state)
      }
    }
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
              run: (script, options) => this.hosts.get(hostId)!.host.run(script, options)
            },
            host.machine.kind === 'local' ? LOCAL_SCAN_LIMITS : SSH_SCAN_LIMITS,
            () =>
              this.deps.extraRoots?.(hostId) ?? { claudeProjectsDirs: [], codexSessionsDirs: [] }
          ),
          sessions: [],
          nextScanAt: 0,
          scanning: false
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
        state.sessions = result.sessions
      }
      this.setHostError(hostId, result.complete ? null : 'The scan was cut short')
      this.publish()
    } catch (error) {
      this.deps.log?.(`[live-sessions] scan of ${hostId} failed`, error)
      this.setHostError(hostId, error instanceof Error ? error.message : String(error))
    } finally {
      state.scanning = false
      state.nextScanAt =
        this.now() +
        (state.host.machine.kind === 'local' ? this.intervals.local : this.intervals.ssh)
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

  private publish(): void {
    const discovered = [...this.hosts.values()].flatMap((s) => s.sessions)
    const merged = mergeSealPanes(discovered, this.deps.sealPanes(), this.deps.localMachine)
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
    for (const sessionId of this.published.keys()) {
      if (!seen.has(sessionId)) {
        this.published.delete(sessionId)
        this.emit({ type: 'remove', revision: ++this.revision, sessionId })
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
