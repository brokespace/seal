import { useAppStore } from '@/store'
import { isTabOnScreen, onScreenWorkspaceIds } from '@/hooks/agent-auto-ack-targets'
import { paneKeyTabId } from '@/store/slices/workspace-attention/workspace-live-markers'
import { isActiveLiveSession } from '../../../../shared/live-sessions/live-session-status'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { liveSessionPaneKeyOf } from '../../../../shared/live-sessions/live-session-surface'
import type { LiveSessionMarksStore } from './live-session-marks-store'
import { liveSessionRegistryStore } from './live-session-registry-store'

type Subscribe = (listener: () => void) => () => void

export type LiveSessionTabAttentionJoinDeps = {
  sessions: {
    get: () => readonly Pick<
      LiveSession,
      'id' | 'lastActivityAt' | 'surface' | 'alive' | 'status'
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
    /** The pane's tab is on screen in front of the user. */
    viewing: (paneKey: string) => boolean
  }
  marks: Pick<LiveSessionMarksStore, 'getState' | 'subscribe' | 'markSeen' | 'onStopped'>
  now?: () => number
}

/** A pane's own exit report can raise the completion marker this long after its agent was stopped. */
const STOPPED_AGENT_MARKER_MS = 60_000

/** A terminal pane whose agent Seal stopped for the user, while its exit report may still come. */
type StoppedAgent = { sessionId: string; at: number; rowGone: boolean }

/**
 * A session that runs in a Seal pane is read in one place and counts as read in the other: its
 * tab, once viewed, marks the record seen; the record, once seen in a session view, acknowledges
 * the tab's attention. A terminal pane whose agent the user had Seal stop gives up the completion
 * marker that stop raises; an agent that exits or crashes by itself keeps its marker and its
 * unread row. An agent gone from its pane is seen once the tab it ran in is on screen. Returns the
 * stop function.
 */
export function joinLiveSessionMarksWithTabAttention({
  sessions,
  tabAttention,
  marks,
  now = Date.now
}: LiveSessionTabAttentionJoinDeps): () => void {
  let lastSessions: unknown = undefined
  const stopped = new Map<string, StoppedAgent>()
  /** The acknowledgement each release left on its pane: nobody viewed the tab for it. */
  const releasedAt = new Map<string, number>()
  let releasing = false

  const runsAnotherAgent = (paneKey: string, agent: StoppedAgent, hasRow: boolean): boolean => {
    if (hasRow && agent.rowGone) {
      return true
    }
    return sessions.get().some((session) => {
      const surface = session.surface
      return (
        surface.kind === 'cli' &&
        surface.paneKey === paneKey &&
        session.id !== agent.sessionId &&
        isActiveLiveSession(session)
      )
    })
  }

  const releaseStoppedAgentMarkers = (): void => {
    if (stopped.size === 0 || releasing) {
      return
    }
    const attention = tabAttention.get()
    const paneKeys: string[] = []
    for (const [paneKey, agent] of stopped) {
      const hasRow = Boolean(attention.agentStatusByPaneKey[paneKey])
      // A marker raised now would be a later agent's, or comes too late to be this stop's.
      if (now() - agent.at > STOPPED_AGENT_MARKER_MS || runsAnotherAgent(paneKey, agent, hasRow)) {
        stopped.delete(paneKey)
        continue
      }
      agent.rowGone ||= !hasRow
      if (attention.unreadAgentCompletionPanes[paneKey]) {
        paneKeys.push(paneKey)
      }
    }
    if (paneKeys.length === 0) {
      return
    }
    const before = attention.acknowledgedAgentsByPaneKey
    releasing = true
    try {
      tabAttention.acknowledgeAgents(paneKeys)
    } finally {
      releasing = false
    }
    const after = tabAttention.get().acknowledgedAgentsByPaneKey
    for (const paneKey of paneKeys) {
      if (after[paneKey] !== undefined && after[paneKey] !== before[paneKey]) {
        releasedAt.set(paneKey, after[paneKey])
      }
    }
  }

  const noteStopped: Parameters<LiveSessionMarksStore['onStopped']>[0] = (ended) => {
    const attention = tabAttention.get()
    for (const session of ended) {
      const surface = session.surface
      // An agent already gone reports no exit; a chat's tab still holds the reply it stopped on.
      if (session.alive && surface.kind === 'cli') {
        stopped.set(surface.paneKey, {
          sessionId: session.id,
          at: now(),
          rowGone: !attention.agentStatusByPaneKey[surface.paneKey]
        })
      }
    }
    releaseStoppedAgentMarkers()
  }
  let lastAcknowledged: unknown = undefined
  let lastSeenAt = marks.getState().seenAt
  let markingFromTab = false

  const markViewedTabsSeen = (): void => {
    // Mid-release the acknowledgement is not yet known to be the release's own.
    if (releasing) {
      return
    }
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
        // A release acknowledges the pane without anybody having viewed its tab.
        if (
          paneKey !== null &&
          acknowledgedAt !== undefined &&
          acknowledgedAt !== releasedAt.get(paneKey) &&
          acknowledgedAt >= session.lastActivityAt
        ) {
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

  /** The pane each CLI session ran in: once its agent is gone it is listed without one. */
  const ranIn = new Map<string, { paneKey: string; ended: boolean }>()
  let lastListed: unknown = undefined
  let lastSeenForGone: unknown = undefined
  let goneUnread: { id: string; paneKey: string; lastActivityAt: number }[] = []

  const noteGoneAgents = (): void => {
    const listed = sessions.get()
    const { seenAt } = marks.getState()
    if (listed === lastListed && seenAt === lastSeenForGone) {
      return
    }
    lastSeenForGone = seenAt
    if (listed !== lastListed) {
      lastListed = listed
      const ids = new Set<string>()
      for (const session of listed) {
        ids.add(session.id)
        const surface = session.surface
        const ran = ranIn.get(session.id)
        if (surface.kind === 'cli') {
          ranIn.set(session.id, { paneKey: surface.paneKey, ended: false })
        } else if (ran && !session.alive) {
          ran.ended = true
        } else if (ran?.ended) {
          // Resumed somewhere else: the pane no longer shows where it stands. An agent on its
          // way out is listed alive without its pane first, which is not that.
          ranIn.delete(session.id)
        }
      }
      for (const id of ranIn.keys()) {
        if (!ids.has(id)) {
          ranIn.delete(id)
        }
      }
    }
    goneUnread = listed.flatMap((session) => {
      const ran = ranIn.get(session.id)
      return ran?.ended && (seenAt[session.id] ?? 0) < session.lastActivityAt
        ? [{ id: session.id, paneKey: ran.paneKey, lastActivityAt: session.lastActivityAt }]
        : []
    })
  }

  const markGoneAgentsSeenInViewedTabs = (): void => {
    noteGoneAgents()
    markingFromTab = true
    try {
      for (const { id, paneKey, lastActivityAt } of goneUnread) {
        if (tabAttention.viewing(paneKey)) {
          marks.markSeen(id, lastActivityAt)
        }
      }
    } finally {
      markingFromTab = false
    }
  }

  const onStoresChanged = (): void => {
    releaseStoppedAgentMarkers()
    markViewedTabsSeen()
    markGoneAgentsSeenInViewedTabs()
  }
  const stops = [
    sessions.subscribe(onStoresChanged),
    tabAttention.subscribe(onStoresChanged),
    marks.subscribe(acknowledgeSeenTabs),
    marks.onStopped(noteStopped)
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
      acknowledgeAgents: (paneKeys) => useAppStore.getState().acknowledgeAgents(paneKeys),
      viewing: (paneKey) => {
        const state = useAppStore.getState()
        const tabId = paneKeyTabId(paneKey)
        return (
          tabId !== null &&
          onScreenWorkspaceIds(state).some((workspaceId) =>
            isTabOnScreen(state, workspaceId, tabId, 'terminal')
          )
        )
      }
    },
    marks
  })
}
