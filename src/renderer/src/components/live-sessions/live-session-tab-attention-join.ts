import { useAppStore } from '@/store'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { liveSessionPaneKeyOf } from '../../../../shared/live-sessions/live-session-surface'
import type { LiveSessionMarksStore } from './live-session-marks-store'
import { liveSessionRegistryStore } from './live-session-registry-store'

type Subscribe = (listener: () => void) => () => void

export type LiveSessionTabAttentionJoinDeps = {
  sessions: {
    get: () => readonly Pick<LiveSession, 'id' | 'lastActivityAt' | 'surface' | 'inputRoutes'>[]
    subscribe: Subscribe
  }
  tabAttention: {
    get: () => {
      acknowledgedAgentsByPaneKey: Readonly<Record<string, number>>
      unreadAgentCompletionPanes: Readonly<Record<string, unknown>>
    }
    /** Fires on every app-store write. */
    subscribe: Subscribe
    acknowledgeAgents: (paneKeys: string[]) => void
  }
  marks: Pick<LiveSessionMarksStore, 'getState' | 'subscribe' | 'markSeen'>
}

/**
 * A session that runs in a Seal pane is read in one place and counts as read in the other: its
 * tab, once viewed, marks the record seen; the record, once seen in a session view, acknowledges
 * the tab's attention. Returns the stop function.
 */
export function joinLiveSessionMarksWithTabAttention({
  sessions,
  tabAttention,
  marks
}: LiveSessionTabAttentionJoinDeps): () => void {
  let lastSessions: unknown = undefined
  let lastAcknowledged: unknown = undefined
  let lastSeenAt = marks.getState().seenAt
  let markingFromTab = false

  const markViewedTabsSeen = (): void => {
    const listed = sessions.get()
    const acknowledged = tabAttention.get().acknowledgedAgentsByPaneKey
    if (listed === lastSessions && acknowledged === lastAcknowledged) {
      return
    }
    lastSessions = listed
    lastAcknowledged = acknowledged
    markingFromTab = true
    try {
      for (const session of listed) {
        if ((marks.getState().seenAt[session.id] ?? 0) >= session.lastActivityAt) {
          continue
        }
        const paneKey = liveSessionPaneKeyOf(session)
        const acknowledgedAt = paneKey === null ? undefined : acknowledged[paneKey]
        if (acknowledgedAt !== undefined && acknowledgedAt >= session.lastActivityAt) {
          marks.markSeen(session.id, session.lastActivityAt)
        }
      }
    } finally {
      markingFromTab = false
    }
  }

  const acknowledgeSeenTabs = (): void => {
    const before = lastSeenAt
    const { seenAt } = marks.getState()
    lastSeenAt = seenAt
    // Marks made from a tab view stay out: that view predates any completion marker raised since.
    if (seenAt === before || markingFromTab) {
      return
    }
    const attention = tabAttention.get()
    const paneKeys: string[] = []
    for (const session of sessions.get()) {
      const seen = seenAt[session.id]
      const seenBefore = before[session.id]
      // A first mark is the baseline of a newly listed session, not a look at it.
      const looked = seenBefore !== undefined && seen !== undefined && seen > seenBefore
      if (!looked || seen < session.lastActivityAt) {
        continue
      }
      const paneKey = liveSessionPaneKeyOf(session)
      if (
        paneKey !== null &&
        (attention.unreadAgentCompletionPanes[paneKey] ||
          (attention.acknowledgedAgentsByPaneKey[paneKey] ?? 0) < session.lastActivityAt)
      ) {
        paneKeys.push(paneKey)
      }
    }
    if (paneKeys.length > 0) {
      tabAttention.acknowledgeAgents(paneKeys)
    }
  }

  const stops = [
    sessions.subscribe(markViewedTabsSeen),
    tabAttention.subscribe(markViewedTabsSeen),
    marks.subscribe(acknowledgeSeenTabs)
  ]
  markViewedTabsSeen()
  return () => {
    for (const stop of stops) {
      stop()
    }
  }
}

/** The join over the app's own stores: the session registry and the app store's tab attention. */
export function startLiveSessionTabAttentionJoin(marks: LiveSessionMarksStore): () => void {
  return joinLiveSessionMarksWithTabAttention({
    sessions: {
      get: () => liveSessionRegistryStore.getState().sessions,
      subscribe: liveSessionRegistryStore.subscribe
    },
    tabAttention: {
      get: useAppStore.getState,
      subscribe: useAppStore.subscribe,
      acknowledgeAgents: (paneKeys) => useAppStore.getState().acknowledgeAgents(paneKeys)
    },
    marks
  })
}
