// Session status summaries: one short sentence per waiting agent, made on the host that owns the session.

import type { SessionSummaryModels } from '../utility-model/utility-model-selection'

export type SessionSummarySettings = {
  /** Off stops new summaries on this host; absent means on whenever a utility model is configured. */
  sessionSummariesEnabled?: boolean
  /** Off stops session recaps on this host, leaving the one-line summaries; absent means on. */
  sessionRecapEnabled?: boolean
  /** The provider and models that write summaries and recaps; absent means Cloudflare Workers AI. */
  sessionSummaryModels?: SessionSummaryModels
}

/** Why a host is not summarizing right now. */
export type SessionSummariesStatus = {
  enabled: boolean
  /** Session recaps are on; absent from a host that predates them. */
  recapEnabled?: boolean
  /** The provider chosen for summaries has an account on this host. */
  configured: boolean
  /** Held after a rate limit until this time; null when running. */
  pausedUntil: number | null
  /** What summaries and recaps run on; absent from a host that predates the choice (Cloudflare Workers AI). */
  models?: SessionSummaryModels
  /** The same two facts for the provider recaps run on; absent from a host that predates the choice. */
  recapConfigured?: boolean
  recapPausedUntil?: number | null
}

/** What a session row shows: the sentence, or that one is being written. */
export type SessionSummaryView = { text: string | null; pending: boolean }

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
