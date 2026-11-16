import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useAppStore } from '../../../store'
import { liveSessionRegistryStore } from '../live-session-registry-store'
import { currentLiveSessionPaneStatuses } from './live-session-pane-statuses'
import type { LiveSessionPaneStatuses } from '../../../../../shared/live-sessions/live-session-pane-activity'

/** Tab glyphs and workspace dots are computed from the app store; a session change must reach them. */
export function useLiveSessionPaneStatusSync(): void {
  const statuses = useSyncExternalStore(
    liveSessionRegistryStore.subscribe,
    currentLiveSessionPaneStatuses,
    currentLiveSessionPaneStatuses
  )
  const previousRef = useRef<LiveSessionPaneStatuses>(new Map())
  useEffect(() => {
    const previous = previousRef.current
    previousRef.current = statuses
    // The workspace projection recomputes only the panes it is told about.
    const changed = new Set<string>()
    for (const [paneKey, status] of statuses) {
      if (previous.get(paneKey) !== status) {
        changed.add(paneKey)
      }
    }
    for (const paneKey of previous.keys()) {
      if (!statuses.has(paneKey)) {
        changed.add(paneKey)
      }
    }
    useAppStore.setState((s) => ({
      agentStatusByPaneKey: changed.size
        ? s.agentStatusByPaneKey.refresh([...changed])
        : s.agentStatusByPaneKey,
      agentStatusEpoch: s.agentStatusEpoch + 1
    }))
  }, [statuses])
}
