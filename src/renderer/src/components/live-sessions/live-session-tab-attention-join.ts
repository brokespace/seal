import { useAppStore } from '@/store'
import { isActiveLiveSession } from '../../../../shared/live-sessions/live-session-status'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import {
  liveSessionPaneKeyOf,
  liveSessionSurfaceOf
} from '../../../../shared/live-sessions/live-session-surface'
import type { LiveSessionMarksStore } from './live-session-marks-store'
import { liveSessionRegistryStore } from './live-session-registry-store'

type Subscribe = (listener: () => void) => () => void

export type LiveSessionTabAttentionJoinDeps = {
  sessions: {
    get: () => readonly Pick<
      LiveSession,
      'id' | 'lastActivityAt' | 'surface' | 'inputRoutes' | 'alive' | 'status'
    >[]
    subscribe: Subscribe
  }
  tabAttention: {
    get: () => {
      acknowledgedAgentsByPaneKey: Readonly<Record<string, number>>
      unreadAgentCompletionPanes: Readonly<Record<string, unknown>>
      agentStatusByPaneKey: Readonly<Record<string, unknown>>
    }
    /** Fires on every app-store write. */
    subscribe: Subscribe
    acknowledgeAgents: (paneKeys: string[]) => void
  }
  marks: Pick<LiveSessionMarksStore, 'getState' | 'subscribe' | 'markSeen'>
  now?: () => number
}

/** A pane's own exit report can raise the completion marker this long after its agent is gone. */
const ENDED_AGENT_MARKER_MS = 60_000

/**
 * A session that runs in a Seal pane is read in one place and counts as read in the other: its
 * tab, once viewed, marks the record seen; the record, once seen in a session view, acknowledges
 * the tab's attention. A terminal pane whose agent has ended gives its completion marker up.
 * Returns the stop function.
 */
export function joinLiveSessionMarksWithTabAttention({
  sessions,
  tabAttention,
  marks,
  now = Date.now
}: LiveSessionTabAttentionJoinDeps): () => void {
  let lastSessions: unknown = undefined
  let runningIn = new Set<string>()
  let lastRunning: unknown = undefined
  const endedAt = new Map<string, number>()
  let releasing = false

  const noteEndedAgents = (): void => {
    const listed = sessions.get()
    if (listed === lastRunning) {
      return
    }
    lastRunning = listed
    const running = new Set<string>()
    for (const session of listed) {
      const surface = liveSessionSurfaceOf(session)
      // A chat's tab still holds the unread reply after its agent process is reaped.
      if (surface.kind === 'cli' && isActiveLiveSession(session)) {
        running.add(surface.paneKey)
      }
    }
    for (const paneKey of runningIn) {
      if (!running.has(paneKey)) {
        endedAt.set(paneKey, now())
      }
    }
    for (const paneKey of running) {
      endedAt.delete(paneKey)
    }
    runningIn = running
  }

  const releaseEndedAgentMarkers = (): void => {
    noteEndedAgents()
    if (endedAt.size === 0 || releasing) {
      return
    }
    const attention = tabAttention.get()
    const paneKeys: string[] = []
    for (const [paneKey, at] of endedAt) {
      // Another agent runs in the pane now, or the marker would be a later one's.
      if (attention.agentStatusByPaneKey[paneKey] || now() - at > ENDED_AGENT_MARKER_MS) {
        endedAt.delete(paneKey)
      } else if (attention.unreadAgentCompletionPanes[paneKey]) {
        paneKeys.push(paneKey)
      }
    }
    if (paneKeys.length > 0) {
      releasing = true
      try {
        tabAttention.acknowledgeAgents(paneKeys)
      } finally {
        releasing = false
      }
    }
  }
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

  const onStoresChanged = (): void => {
    releaseEndedAgentMarkers()
    markViewedTabsSeen()
  }
  const stops = [
    sessions.subscribe(onStoresChanged),
    tabAttention.subscribe(onStoresChanged),
    marks.subscribe(acknowledgeSeenTabs)
  ]
  onStoresChanged()
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
