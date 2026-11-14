import type { SessionSummaryView } from './session-summary-contracts'

/** What a client draws for a registry session: its summary, a placeholder while one is made, or nothing. */
export function liveSessionSummaryView(session: {
  summary?: string
  summaryPending?: boolean
}): SessionSummaryView | null {
  if (session.summary) {
    return { text: session.summary, pending: false }
  }
  return session.summaryPending ? { text: null, pending: true } : null
}
