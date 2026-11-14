import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { liveSessionSummaryView } from '../../../../shared/session-summaries/live-session-summary-view'
import type { SessionSummaryView } from '../../../../shared/session-summaries/session-summary-contracts'

/** How a row names its agent: its Seal pane, and the conversation it runs when the host knows it. */
export type SessionSummaryRef = {
  paneKey: string
  agentType?: string | null
  providerSessionId?: string | null
}

export type SessionSummaryIndex = {
  byPane: ReadonlyMap<string, SessionSummaryView>
  byConversation: ReadonlyMap<string, SessionSummaryView>
}

function conversationKey(agentType: string, providerSessionId: string): string {
  return `${agentType}:${providerSessionId}`
}

const indexes = new WeakMap<readonly LiveSession[], SessionSummaryIndex>()

/** Summaries the session registry carries, findable by the pane or conversation a row shows. */
export function sessionSummaryIndex(sessions: readonly LiveSession[]): SessionSummaryIndex {
  const known = indexes.get(sessions)
  if (known) {
    return known
  }
  const byPane = new Map<string, SessionSummaryView>()
  const byConversation = new Map<string, SessionSummaryView>()
  for (const session of sessions) {
    const view = liveSessionSummaryView(session)
    if (!view) {
      continue
    }
    for (const route of session.inputRoutes) {
      if (route.kind === 'seal-pane') {
        byPane.set(route.paneKey, view)
      }
    }
    // A pane on a paired server is the registry's session for the same conversation.
    byConversation.set(conversationKey(session.provider, session.providerSessionId), view)
  }
  const index = { byPane, byConversation }
  indexes.set(sessions, index)
  return index
}

export function sessionSummaryFor(
  index: SessionSummaryIndex,
  ref: SessionSummaryRef
): SessionSummaryView | null {
  const byPane = index.byPane.get(ref.paneKey)
  if (byPane) {
    return byPane
  }
  return ref.agentType && ref.providerSessionId
    ? (index.byConversation.get(conversationKey(ref.agentType, ref.providerSessionId)) ?? null)
    : null
}
