import { useEffect, useSyncExternalStore } from 'react'
import { useAppStore } from '../../../store'
import { liveSessionRegistryStore } from '../live-session-registry-store'
import { currentLiveSessionPaneStatuses } from './live-session-pane-statuses'

/** Tab glyphs and workspace dots are computed from the app store; a session change must reach them. */
export function useLiveSessionPaneStatusSync(): void {
  const statuses = useSyncExternalStore(
    liveSessionRegistryStore.subscribe,
    currentLiveSessionPaneStatuses,
    currentLiveSessionPaneStatuses
  )
  useEffect(() => {
    useAppStore.setState((s) => ({ agentStatusEpoch: s.agentStatusEpoch + 1 }))
  }, [statuses])
}
