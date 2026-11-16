import { useSyncExternalStore } from 'react'

export type AgentSessionPanel = 'recap' | 'subagents' | 'tasks'
export type AgentSessionFocusTarget = AgentSessionPanel | 'composer' | 'permission'

/** Something a menu asked a session's open view to show; `nonce` tells repeats apart. */
export type AgentSessionFocusRequest = {
  sessionId: string
  target: AgentSessionFocusTarget
  nonce: number
}

let latest: AgentSessionFocusRequest | null = null
let nonce = 0
const listeners = new Set<() => void>()

function set(next: AgentSessionFocusRequest | null): void {
  latest = next
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Ask a session's open view to show its recap, subagents, tasks, composer or permission card. */
export function requestAgentSessionFocus(sessionId: string, target: AgentSessionFocusTarget): void {
  set({ sessionId, target, nonce: ++nonce })
}

/** The same session under the id its transcript gave it keeps its request. */
export function renameAgentSessionFocus(fromSessionId: string, toSessionId: string): void {
  if (latest?.sessionId === fromSessionId) {
    set({ ...latest, sessionId: toSessionId })
  }
}

/** The newest request for `sessionId`, or null; a view acts once per `nonce`. */
export function useAgentSessionFocusRequest(
  sessionId: string | null
): AgentSessionFocusRequest | null {
  const request = useSyncExternalStore(subscribe, () => latest)
  return request && request.sessionId === sessionId ? request : null
}
