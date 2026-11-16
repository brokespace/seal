import type { AgentPaneChange } from '../agent-hooks/observations/agent-transition-detector'
import type { AgentStatusIpcPayload } from '../../shared/agent-status/contracts/agent-status-ipc-payload'
import { isSettledLiveSessionStatus } from '../../shared/live-sessions/live-session-status'
import { liveSessionPaneKeyOf } from '../../shared/live-sessions/live-session-surface'
import type {
  LiveSession,
  LiveSessionRegistryEvent
} from '../../shared/live-sessions/live-session-types'
import type { SessionSummariesListResult } from '../../shared/session-summaries/session-summary-contracts'
import { structuredSessionIdFromNotificationPane } from '../../shared/structured-session-notification-pane'
import { TerminalAgentTurnNews } from '../runtime/push/notifications/terminal-agent-turn-news'
import { paneRecordId } from './pane-record-id'
import { ServerSessionSummaries, serverOf } from './server-session-summaries'
import type { SessionSummarizer, SessionSummaryView } from './session-summarizer'
import { unrefTimer } from './unref-timer'

export type PaneSessionIdentity = { paneKey: string; agentType: string; providerSessionId: string }

export type LiveSessionSummariesDeps = {
  summarizer: Pick<SessionSummarizer, 'request' | 'clear' | 'forget' | 'view'>
  /** The hook row of one of this host's own panes: a CLI agent's terminal, or a chat. */
  readHookRow: (paneKey: string) => AgentStatusIpcPayload | null
  /** The agent's newest own words in a registry session's transcript; null when it has said nothing. */
  lastAssistantText: (sessionId: string) => Promise<string | null>
  /** The same from the journal of a chat this host holds. */
  chatLastAssistantText: (chatSessionId: string) => Promise<string | null>
  /** False on a headless server: it summarizes its own panes, and the desktop that sees its registry the rest. */
  summarizeRegistry: boolean
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

type Pane = {
  /** The record id its summary is kept under. */
  key: string
  identity: PaneSessionIdentity | null
  /** The chat stop last handled, so a republished row reads no journal. */
  chatStamp: string | null
}

type PaneStop = { paneKey: string; row: AgentStatusIpcPayload }

function stopped(session: LiveSession): boolean {
  return isSettledLiveSessionStatus(session.status)
}

/**
 * One summary per session, kept under its record id. An agent in one of this host's panes is
 * summarized from its hook row the moment its turn ends (a chat from its journal); a paired
 * server's own summary is shown as is; any other registry session is summarized from its
 * transcript when it stops for its user or parks on a subagent.
 */
export class LiveSessionSummaries {
  private readonly tracked = new Map<string, Tracked>()
  private readonly panes = new Map<string, Pane>()
  private readonly news: TerminalAgentTurnNews<PaneStop>
  private readonly servers: ServerSessionSummaries | null

  constructor(private readonly deps: LiveSessionSummariesDeps) {
    const setTimer = deps.setTimer ?? unrefTimer
    // Turn timing is the phone push's: a finished or asking turn, and a lead turn that ended while its children still run.
    this.news = new TerminalAgentTurnNews<PaneStop>({
      readHookRow: deps.readHookRow,
      prepare: ({ paneKey, row }) => ({ paneKey, row }),
      deliver: (stop) => this.paneStopped(stop),
      setTimer,
      started: ({ paneKey }) => this.clearPane(paneKey),
      everyLeadTurn: true
    })
    const fetch = deps.serverSummaries
    this.servers = fetch
      ? new ServerSessionSummaries({
          fetch,
          waiting: (server) =>
            [...this.tracked.values()].some(
              ({ session }) =>
                serverOf(session) === server &&
                session.alive &&
                stopped(session) &&
                this.servers?.entry(session)?.text === null
            ),
          onChange: deps.onChange,
          setTimer,
          now: deps.now ?? Date.now
        })
      : null
  }

  /** A pane's hook status changed. */
  observePane(change: AgentPaneChange): void {
    const { paneKey } = change
    const row = this.deps.readHookRow(paneKey)
    const known = this.panes.get(paneKey)
    const key = row ? paneRecordId(paneKey, row) : null
    if (known && known.key !== key) {
      this.panes.delete(paneKey)
      this.deps.summarizer.forget(known.key)
    }
    if (!row || !key) {
      this.news.observe(change)
      return
    }
    const pane = this.panes.get(paneKey) ?? { key, identity: null, chatStamp: null }
    // Named before any summary exists, so another host knows this pane is summarized here.
    pane.identity = row.providerSession?.id
      ? {
          paneKey,
          agentType: row.agentType ?? 'unknown',
          providerSessionId: row.providerSession.id
        }
      : null
    this.panes.set(paneKey, pane)
    if (row.structuredHost) {
      this.chatChanged(paneKey, row, pane)
      return
    }
    this.news.observe(change)
    // A restored pane already stopped announces nothing, yet still shows its (cached) summary.
    if (
      change.kind === 'seeded' &&
      change.phase !== 'working' &&
      (row.state === 'done' || row.state === 'waiting')
    ) {
      this.paneStopped({ paneKey, row })
    }
  }

  observe(event: LiveSessionRegistryEvent): void {
    if (!this.deps.summarizeRegistry) {
      return
    }
    if (event.type === 'remove') {
      this.tracked.delete(event.sessionId)
      this.deps.summarizer.forget(event.sessionId)
      return
    }
    if (event.type !== 'upsert') {
      return
    }
    const { session } = event
    if (this.paneOf(session)) {
      this.tracked.delete(session.id)
      return
    }
    const tracked = this.tracked.get(session.id)
    if (tracked) {
      tracked.session = session
    }
    const now = tracked ?? { session, stamp: null, reading: false, again: false }
    this.tracked.set(session.id, now)
    const server = serverOf(session)
    if (server && this.servers) {
      // The server's answer decides who summarizes, so it comes first.
      void this.servers.refresh(server, true).then(() => this.settle(now))
      return
    }
    this.settle(now)
  }

  /** The session as clients see it: its summary, or that one is on its way. */
  decorate(session: LiveSession): LiveSession {
    if (!this.deps.summarizeRegistry || !session.alive) {
      return session
    }
    const pane = this.paneOf(session)
    const view = pane
      ? this.deps.summarizer.view(pane.key)
      : (this.serverView(session) ?? this.deps.summarizer.view(session.id))
    if (!view) {
      return session
    }
    if (view.text !== null) {
      return { ...session, summary: view.text }
    }
    return view.pending ? { ...session, summaryPending: true } : session
  }

  /** The summary of the agent in one of this host's panes, for the agent rows clients read. */
  paneView(paneKey: string): SessionSummaryView | null {
    const pane = this.panes.get(paneKey)
    return pane ? this.deps.summarizer.view(pane.key) : null
  }

  /** Every pane summarized here, named by the conversation it runs so another host can match it. */
  list(): (PaneSessionIdentity & SessionSummaryView)[] {
    return [...this.panes.values()].flatMap(({ key, identity }) =>
      identity
        ? [{ ...identity, ...(this.deps.summarizer.view(key) ?? { text: null, pending: false }) }]
        : []
    )
  }

  dispose(): void {
    this.news.dispose()
    this.servers?.dispose()
    this.panes.clear()
    this.tracked.clear()
  }

  /** The pane on this host that owns the session, which then summarizes it. */
  private paneOf(session: LiveSession): Pane | null {
    const paneKey = liveSessionPaneKeyOf(session)
    return (paneKey && this.panes.get(paneKey)) || null
  }

  private clearPane(paneKey: string): void {
    const pane = this.panes.get(paneKey)
    if (pane) {
      this.deps.summarizer.clear(pane.key)
    }
  }

  private paneStopped({ paneKey, row }: PaneStop): void {
    const pane = this.panes.get(paneKey)
    // An approval prompt already says what it needs; tool output is not the agent's own words.
    if (!pane || row.state === 'blocked') {
      return
    }
    const message = row.lastAssistantMessageIsToolOutput ? undefined : row.lastAssistantMessage
    if (message) {
      this.deps.summarizer.request(pane.key, message, row.state === 'waiting')
    }
  }

  /** A chat's turns are not terminal news, and its row holds only a clipped preview: its stops are read off the row and its words from the journal. */
  private chatChanged(paneKey: string, row: AgentStatusIpcPayload, pane: Pane): void {
    if (row.state === 'blocked') {
      return
    }
    if (row.state !== 'done' && row.state !== 'waiting') {
      pane.chatStamp = null
      this.deps.summarizer.clear(pane.key)
      return
    }
    const stamp = `${row.state}:${row.stateStartedAt}`
    const chat = structuredSessionIdFromNotificationPane(paneKey)
    if (pane.chatStamp === stamp || !chat) {
      return
    }
    pane.chatStamp = stamp
    void this.deps
      .chatLastAssistantText(chat)
      .catch((error: unknown) => {
        this.deps.log?.('[session-summaries] reading a chat journal failed', error)
        return null
      })
      .then((text) => {
        const message = text ?? row.lastAssistantMessage
        if (message && this.panes.get(paneKey) === pane && pane.chatStamp === stamp) {
          this.deps.summarizer.request(pane.key, message, row.state === 'waiting')
        }
      })
  }

  private settle(tracked: Tracked): void {
    const { session } = tracked
    if (this.tracked.get(session.id) !== tracked) {
      return
    }
    if (!session.alive || this.servers?.entry(session) || this.paneOf(session)) {
      tracked.stamp = null
      this.deps.summarizer.forget(session.id)
      return
    }
    if (!stopped(session)) {
      // A permission prompt keeps the summary of the turn it interrupts.
      if (session.status !== 'needs-permission') {
        tracked.stamp = null
        this.deps.summarizer.clear(session.id)
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
          this.deps.summarizer.request(sessionId, text, asking)
        }
      })
  }

  private serverView(session: LiveSession): SessionSummaryView | null {
    const entry = this.servers?.entry(session)
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
}
