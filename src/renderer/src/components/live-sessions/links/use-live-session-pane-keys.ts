import { useSyncExternalStore } from 'react'
import { liveSessionPaneKeys } from '../../../../../shared/live-sessions/live-session-pane-keys'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { liveSessionRegistryStore } from '../live-session-registry-store'

let memo: { sessions: readonly LiveSession[]; keys: ReadonlySet<string> } = {
  sessions: [],
  keys: new Set()
}

// Every workspace card asks; the set keeps its identity until a pane joins or leaves it.
function currentPaneKeys(): ReadonlySet<string> {
  const { sessions } = liveSessionRegistryStore.getState()
  if (sessions !== memo.sessions) {
    const next = liveSessionPaneKeys(sessions)
    const same = next.size === memo.keys.size && [...next].every((key) => memo.keys.has(key))
    memo = { sessions, keys: same ? memo.keys : next }
  }
  return memo.keys
}

/** Panes a surface that lists pane agents must leave to the session's own row and badge. */
export function useLiveSessionPaneKeys(): ReadonlySet<string> {
  return useSyncExternalStore(liveSessionRegistryStore.subscribe, currentPaneKeys, currentPaneKeys)
}
