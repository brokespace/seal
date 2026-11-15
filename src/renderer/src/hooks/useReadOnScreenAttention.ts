import { useEffect } from 'react'
import { subscribeStructuredAttentionViews } from '@/attention/agent-subject-read-actions'
import { subscribeAutoAckPresenceSignals } from './agent-auto-ack-presence'
import { useAppStore } from '@/store/index'
import { isWebClientLocation } from '@/app-shell/platform/web-client-location'
import { startOnScreenAttentionScan } from './on-screen-attention-scan'
import { subscribeSplitViewWorkspaces } from '@/components/split-view/split-view-workspaces-on-view'
import { ORCA_SIDEBAR_INPUTS_IS_MAIN } from '../../../shared/sidebar-inputs-switch'
import {
  createClientWorkspaceViewReporter,
  subscribeViewReportPresenceSignals
} from './client-workspace-view-report'

export function useReadOnScreenAttention(): void {
  useEffect(() => {
    const subscribePresenceSignals = ORCA_SIDEBAR_INPUTS_IS_MAIN
      ? subscribeViewReportPresenceSignals
      : subscribeAutoAckPresenceSignals
    return startOnScreenAttentionScan(useAppStore, {
      readDesktopAway: isWebClientLocation()
        ? null
        : async () => window.api?.notifications?.getDesktopAwayState?.(),
      subscribeStructuredViews: subscribeStructuredAttentionViews,
      subscribePresenceSignals: (onRescan, onInput) => {
        const stopSignals = subscribePresenceSignals(onRescan, onInput)
        // A workspace arriving in a split-view pane is on screen without an app-store write.
        const stopPanes = subscribeSplitViewWorkspaces(onRescan)
        return () => {
          stopSignals()
          stopPanes()
        }
      },
      ...(ORCA_SIDEBAR_INPUTS_IS_MAIN ? { viewReporter: createClientWorkspaceViewReporter() } : {})
    })
  }, [])
}
