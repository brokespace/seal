import { useSyncExternalStore } from 'react'
import { liveSessionRegistryStore } from '@/components/live-sessions/live-session-registry-store'
import type { SessionSummaryView } from '../../../../shared/session-summaries/session-summary-contracts'
import {
  sessionSummaryFor,
  sessionSummaryIndex,
  type SessionSummaryRef
} from './session-summary-index'

const PENDING: SessionSummaryView = { text: null, pending: true }

/**
 * The summary for one agent row. The snapshot is the sentence itself, so a row re-renders when its
 * own summary changes and not on every registry event.
 */
export function useSessionSummary(ref: SessionSummaryRef | null): SessionSummaryView | null {
  const paneKey = ref?.paneKey
  const agentType = ref?.agentType
  const providerSessionId = ref?.providerSessionId
  const snapshot = useSyncExternalStore(liveSessionRegistryStore.subscribe, () => {
    if (paneKey === undefined) {
      return null
    }
    const index = sessionSummaryIndex(liveSessionRegistryStore.getState().sessions)
    const view = sessionSummaryFor(index, { paneKey, agentType, providerSessionId })
    // A summary is never empty, so the empty string can stand for "being written".
    return view ? (view.text ?? '') : null
  })
  if (snapshot === null) {
    return null
  }
  return snapshot === '' ? PENDING : { text: snapshot, pending: false }
}
