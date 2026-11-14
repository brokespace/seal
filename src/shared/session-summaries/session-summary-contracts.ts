// Session status summaries: one short sentence per waiting agent, made on the host that owns the session.

export type SessionSummarySettings = {
  /** Off stops new summaries on this host; absent means on whenever a utility model is configured. */
  sessionSummariesEnabled?: boolean
}

/** Why a host is not summarizing right now. */
export type SessionSummariesStatus = {
  enabled: boolean
  /** A utility model provider is configured on this host. */
  configured: boolean
  /** Held after a rate limit until this time; null when running. */
  pausedUntil: number | null
}

/** A summary this host made for an agent in one of its own panes. */
export type SessionSummaryListEntry = {
  paneKey: string
  agentType: string
  providerSessionId: string
  text: string | null
  pending: boolean
}

export type SessionSummariesListResult = {
  status: SessionSummariesStatus
  /** Every pane this host summarizes, so another host shows these instead of making its own. */
  sessions: SessionSummaryListEntry[]
}

export const SESSION_SUMMARIES_LIST_METHOD = 'sessionSummaries.list'
