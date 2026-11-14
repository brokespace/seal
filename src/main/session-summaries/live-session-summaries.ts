import type {
  LiveSession,
  LiveSessionRegistryEvent,
  LiveSessionStatus
} from '../../shared/live-sessions/live-session-types'
import type {
  SessionSummariesListResult,
  SessionSummaryListEntry
} from '../../shared/session-summaries/session-summary-contracts'
import type { SessionSummarizer, SessionSummaryView } from './session-summarizer'

export type LiveSessionSummariesDeps = {
  summarizer: Pick<SessionSummarizer, 'request' | 'clear' | 'forget' | 'view'>
  /** The agent's newest own words in the session's transcript; null when it has said nothing. */
  lastAssistantText: (sessionId: string) => Promise<string | null>
  /** A summary made for one of this host's own panes. */
  paneView: (paneKey: string) => SessionSummaryView | null
  /** What a paired Seal server (by execution host id) summarizes for its own panes; null when it cannot say. */
  serverSummaries?: (executionHostId: string) => Promise<SessionSummariesListResult | null>
  /** A session's summary changed without the registry seeing it. */
  onChange: () => void
  setTimer?: (run: () => void, delayMs: number) => { cancel: () => void }
  now?: () => number
  log?: (message: string, error?: unknown) => void
}

type Tracked = {
  session: LiveSession
  /** The stop last handled, so a rescan of the same stop reads no transcript. */
  stamp: string | null
  reading: boolean
  /** A newer stop arrived while the transcript was being read. */
  again: boolean
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

function defaultTimer(run: () => void, delayMs: number): { cancel: () => void } {
  const timer = setTimeout(run, delayMs)
  timer.unref?.()
  return { cancel: () => clearTimeout(timer) }
}

export function liveSummaryKey(sessionId: string): string {
  return `live:${sessionId}`
}

/** Stopped for its user, or parked on a subagent or background task: the moments a summary describes. */
const SUMMARIZED_STATUSES: ReadonlySet<LiveSessionStatus> = new Set([
  'waiting-input',
  'idle',
  'waiting-subagent',
  'waiting-task'
])

function stopped(session: LiveSession): boolean {
  return SUMMARIZED_STATUSES.has(session.status)
}

function sealPaneKey(session: LiveSession): string | null {
  for (const route of session.inputRoutes) {
    if (route.kind === 'seal-pane') {
      return route.paneKey
    }
  }
  return null
}

/** The Seal server a session runs on, when its machine is reached through one. */
function serverOf(session: LiveSession): string | null {
  return session.machine.connection === 'server' ? (session.machine.executionHostId ?? null) : null
}

function serverKey(agentType: string, providerSessionId: string): string {
  return `${agentType}:${providerSessionId}`
}

/**
 * Summaries for every session in the registry. A Seal pane's comes from its host's hook rows; a
 * paired server's own summary is shown as is; only what is left is summarized here, from the
 * transcript, when the session stops for its user or parks on a subagent.
 */
export class LiveSessionSummaries {
  private readonly tracked = new Map<string, Tracked>()
  private readonly servers = new Map<string, ServerState>()
  private readonly setTimer: NonNullable<LiveSessionSummariesDeps['setTimer']>

  constructor(private readonly deps: LiveSessionSummariesDeps) {
    this.setTimer = deps.setTimer ?? defaultTimer
  }

  observe(event: LiveSessionRegistryEvent): void {
    if (event.type === 'remove') {
      this.tracked.delete(event.sessionId)
      this.deps.summarizer.forget(liveSummaryKey(event.sessionId))
      return
    }
    if (event.type !== 'upsert' || sealPaneKey(event.session)) {
      return
    }
    const { session } = event
    const tracked = this.tracked.get(session.id)
    if (tracked) {
      tracked.session = session
    }
    const now = tracked ?? { session, stamp: null, reading: false, again: false }
    this.tracked.set(session.id, now)
    const server = serverOf(session)
    if (server && this.deps.serverSummaries) {
      // The server's answer decides who summarizes, so it comes first.
      void this.refreshServer(server, true).then(() => this.settle(now))
      return
    }
    this.settle(now)
  }

  /** The session as clients see it: its summary, or that one is on its way. */
  decorate(session: LiveSession): LiveSession {
    if (!session.alive) {
      return session
    }
    const paneKey = sealPaneKey(session)
    const view = paneKey
      ? this.deps.paneView(paneKey)
      : (this.serverView(session) ?? this.deps.summarizer.view(liveSummaryKey(session.id)))
    if (!view) {
      return session
    }
    if (view.text !== null) {
      return { ...session, summary: view.text }
    }
    return view.pending ? { ...session, summaryPending: true } : session
  }

  dispose(): void {
    for (const state of this.servers.values()) {
      state.followUp?.cancel()
    }
    this.servers.clear()
    this.tracked.clear()
  }

  private settle(tracked: Tracked): void {
    const { session } = tracked
    if (this.tracked.get(session.id) !== tracked) {
      return
    }
    const key = liveSummaryKey(session.id)
    if (!session.alive || this.serverEntry(session)) {
      tracked.stamp = null
      this.deps.summarizer.forget(key)
      return
    }
    if (!stopped(session)) {
      // A permission prompt keeps the summary of the turn it interrupts.
      if (session.status !== 'needs-permission') {
        tracked.stamp = null
        this.deps.summarizer.clear(key)
      }
      return
    }
    const stamp = `${session.status}:${session.lastActivityAt}`
    if (tracked.stamp === stamp) {
      return
    }
    tracked.stamp = stamp
    this.read(tracked)
  }

  private read(tracked: Tracked): void {
    if (tracked.reading) {
      tracked.again = true
      return
    }
    tracked.reading = true
    const sessionId = tracked.session.id
    const stamp = tracked.stamp
    void this.deps
      .lastAssistantText(sessionId)
      .catch((error: unknown) => {
        this.deps.log?.('[session-summaries] reading a transcript failed', error)
        return null
      })
      .then((text) => {
        tracked.reading = false
        if (this.tracked.get(sessionId) !== tracked) {
          return
        }
        if (tracked.again) {
          tracked.again = false
          if (tracked.stamp !== null) {
            this.read(tracked)
          }
          return
        }
        if (text && tracked.stamp === stamp && stamp !== null) {
          // Only a question put to the user leads with what the agent needs.
          const asking = tracked.session.status === 'waiting-input'
          this.deps.summarizer.request(liveSummaryKey(sessionId), text, asking)
        }
      })
  }

  private serverEntry(session: LiveSession): SessionSummaryListEntry | null {
    const server = serverOf(session)
    return (
      (server &&
        this.servers
          .get(server)
          ?.sessions.get(serverKey(session.provider, session.providerSessionId))) ||
      null
    )
  }

  private serverView(session: LiveSession): SessionSummaryView | null {
    const entry = this.serverEntry(session)
    if (!entry) {
      return null
    }
    // The server clears its summary when a turn starts; between fetches this host's own status says so first.
    const showing = stopped(session) || session.status === 'needs-permission'
    return {
      text: showing ? entry.text : null,
      pending: showing && entry.text === null && entry.pending
    }
  }

  /** `fresh` restarts the follow-up fetches: a session on the host just changed. */
  private refreshServer(server: string, fresh: boolean): Promise<void> {
    const fetch = this.deps.serverSummaries
    if (!fetch) {
      return Promise.resolve()
    }
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
    const now = this.deps.now?.() ?? Date.now()
    if (now - known.fetchedAt < SERVER_REFRESH_MS) {
      this.followUpLater(server, known)
      return Promise.resolve()
    }
    known.fetchedAt = now
    known.fetching = fetch(server)
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

  /** The server summarizes a moment after its pane stops; look again while one of its stopped sessions has no text. */
  private followUpLater(server: string, state: ServerState): void {
    if (state.followUp || state.followUps <= 0) {
      return
    }
    const waiting = [...this.tracked.values()].some(
      ({ session }) =>
        serverOf(session) === server &&
        session.alive &&
        stopped(session) &&
        this.serverEntry(session)?.text === null
    )
    if (!waiting) {
      return
    }
    state.followUps -= 1
    state.followUp = this.setTimer(() => {
      state.followUp = null
      void this.refreshServer(server, false)
    }, SERVER_FOLLOW_UP_MS)
  }
}
