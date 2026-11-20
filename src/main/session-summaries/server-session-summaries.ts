import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import type {
  SessionSummariesListResult,
  SessionSummaryListEntry
} from '../../shared/session-summaries/session-summary-contracts'

export type ServerSessionSummariesDeps = {
  /** What a paired Seal server (by execution host id) summarizes for its own sessions; null when it cannot say. */
  fetch: (executionHostId: string) => Promise<SessionSummariesListResult | null>
  /** A stopped session on `server` still waits for the server's summary. */
  waiting: (server: string) => boolean
  onChange: () => void
  setTimer: (run: () => void, delayMs: number) => { cancel: () => void }
  now: () => number
}

type ServerState = {
  sessions: Map<string, SessionSummaryListEntry>
  fetchedAt: number
  fetching: Promise<void> | null
  /** Fetches left for a summary the server has not finished yet. */
  followUps: number
  followUp: { cancel: () => void } | null
}

const SERVER_REFRESH_MS = 3_000
const SERVER_FOLLOW_UP_MS = 3_500
const SERVER_FOLLOW_UPS = 4

/** The Seal server a session runs on, when its machine is reached through one. */
export function serverOf(session: LiveSession): string | null {
  return session.machine.connection === 'server' ? (session.machine.executionHostId ?? null) : null
}

function serverKey(agentType: string, providerSessionId: string): string {
  return `${agentType}:${providerSessionId}`
}

/** The summaries paired servers make for their own sessions, which this host shows as they are. */
export class ServerSessionSummaries {
  private readonly servers = new Map<string, ServerState>()

  constructor(private readonly deps: ServerSessionSummariesDeps) {}

  entry(session: LiveSession): SessionSummaryListEntry | null {
    const server = serverOf(session)
    return (
      (server &&
        this.servers
          .get(server)
          ?.sessions.get(serverKey(session.provider, session.providerSessionId))) ||
      null
    )
  }

  /** `fresh` restarts the follow-up fetches: a session on the host just changed. */
  refresh(server: string, fresh: boolean): Promise<void> {
    let state = this.servers.get(server)
    if (!state) {
      state = { sessions: new Map(), fetchedAt: 0, fetching: null, followUps: 0, followUp: null }
      this.servers.set(server, state)
    }
    const known = state
    if (fresh) {
      known.followUps = SERVER_FOLLOW_UPS
    }
    if (known.fetching) {
      return known.fetching
    }
    const now = this.deps.now()
    if (now - known.fetchedAt < SERVER_REFRESH_MS) {
      this.followUpLater(server, known)
      return Promise.resolve()
    }
    known.fetchedAt = now
    known.fetching = this.deps
      .fetch(server)
      .catch(() => null)
      .then((result) => {
        known.fetching = null
        if (this.servers.get(server) !== known) {
          return
        }
        // A server with summaries off or no provider leaves its sessions to this host.
        const summarizing = result?.status.enabled === true && result.status.configured === true
        const next = new Map(
          (summarizing ? result.sessions : []).map((entry) => [
            serverKey(entry.agentType, entry.providerSessionId),
            entry
          ])
        )
        const changed =
          next.size !== known.sessions.size ||
          [...next].some(([key, entry]) => {
            const had = known.sessions.get(key)
            return !had || had.text !== entry.text || had.pending !== entry.pending
          })
        known.sessions = next
        if (changed) {
          this.deps.onChange()
        }
        this.followUpLater(server, known)
      })
    return known.fetching
  }

  dispose(): void {
    for (const state of this.servers.values()) {
      state.followUp?.cancel()
    }
    this.servers.clear()
  }

  /** The server summarizes a moment after its session stops; look again while one of them has no text. */
  private followUpLater(server: string, state: ServerState): void {
    if (state.followUp || state.followUps <= 0 || !this.deps.waiting(server)) {
      return
    }
    state.followUps -= 1
    state.followUp = this.deps.setTimer(() => {
      state.followUp = null
      void this.refresh(server, false)
    }, SERVER_FOLLOW_UP_MS)
  }
}
