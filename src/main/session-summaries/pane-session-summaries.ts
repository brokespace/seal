import type { AgentPaneChange } from '../agent-hooks/observations/agent-transition-detector'
import type { AgentStatusIpcPayload } from '../../shared/agent-status/contracts/agent-status-ipc-payload'
import { TerminalAgentTurnNews } from '../runtime/push/notifications/terminal-agent-turn-news'
import type { SessionSummarizer, SessionSummaryView } from './session-summarizer'

type PaneStop = { paneKey: string; row: AgentStatusIpcPayload }

export type PaneSessionIdentity = { paneKey: string; agentType: string; providerSessionId: string }

export type PaneSessionSummariesDeps = {
  summarizer: Pick<SessionSummarizer, 'request' | 'clear' | 'forget' | 'view'>
  readHookRow: (paneKey: string) => AgentStatusIpcPayload | null
  setTimer: (run: () => void, delayMs: number) => { cancel: () => void }
}

export function paneSummaryKey(paneKey: string): string {
  return `pane:${paneKey}`
}

/**
 * Summaries for agents in this host's own terminal panes, from the hook rows the host already
 * keeps. Turn timing is the phone push's: a finished or asking turn, and a lead turn that ended
 * while its subagents or background tasks still run.
 */
export class PaneSessionSummaries {
  private readonly panes = new Map<string, PaneSessionIdentity>()
  private readonly news: TerminalAgentTurnNews<PaneStop>

  constructor(private readonly deps: PaneSessionSummariesDeps) {
    this.news = new TerminalAgentTurnNews<PaneStop>({
      readHookRow: deps.readHookRow,
      prepare: ({ paneKey, row }) => ({ paneKey, row }),
      deliver: (stop) => this.stopped(stop),
      setTimer: deps.setTimer,
      started: ({ paneKey }) => deps.summarizer.clear(paneSummaryKey(paneKey)),
      everyLeadTurn: true
    })
  }

  observe(change: AgentPaneChange): void {
    const { paneKey } = change
    const row = this.deps.readHookRow(paneKey)
    if (!row) {
      if (this.panes.delete(paneKey) || change.kind === 'moved') {
        this.deps.summarizer.forget(paneSummaryKey(paneKey))
      }
    } else if (row.providerSession?.id && !row.structuredHost) {
      // Named before any summary exists, so another host knows this pane is summarized here.
      this.panes.set(paneKey, {
        paneKey,
        agentType: row.agentType ?? 'unknown',
        providerSessionId: row.providerSession.id
      })
    }
    this.news.observe(change)
    // A restored pane already stopped announces nothing, yet still shows its (cached) summary.
    if (
      row &&
      change.kind === 'seeded' &&
      change.phase !== 'working' &&
      (row.state === 'done' || row.state === 'waiting')
    ) {
      this.stopped({ paneKey, row })
    }
  }

  view(paneKey: string): SessionSummaryView | null {
    return this.deps.summarizer.view(paneSummaryKey(paneKey))
  }

  /** Every pane summarized here, named by the conversation it runs so another host can match it. */
  list(): (PaneSessionIdentity & SessionSummaryView)[] {
    return [...this.panes.values()].map((pane) => ({
      ...pane,
      ...(this.view(pane.paneKey) ?? { text: null, pending: false })
    }))
  }

  dispose(): void {
    this.news.dispose()
    this.panes.clear()
  }

  private stopped({ paneKey, row }: PaneStop): void {
    // An approval prompt already says what it needs; tool output is not the agent's own words.
    if (row.state === 'blocked' || row.structuredHost) {
      return
    }
    const message = row.lastAssistantMessageIsToolOutput ? undefined : row.lastAssistantMessage
    if (!message) {
      return
    }
    this.deps.summarizer.request(paneSummaryKey(paneKey), message, row.state === 'waiting')
  }
}
