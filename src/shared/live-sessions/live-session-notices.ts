import { liveSessionStatusGroup } from './live-session-status'
import type { LiveSession } from './live-session-types'

export type LiveSessionNotice = 'needs-attention' | 'finished'

/**
 * What a status change is worth telling the user about. Waiting on its own subagents or
 * background tasks is still the agent's turn, so entering or leaving that wait alone says nothing.
 */
export function liveSessionNotice(
  before: Pick<LiveSession, 'status'> | undefined,
  after: Pick<LiveSession, 'status'>
): LiveSessionNotice | null {
  if (!before || before.status === after.status) {
    return null
  }
  const was = liveSessionStatusGroup(before.status)
  const is = liveSessionStatusGroup(after.status)
  if (is === 'attention') {
    // An error that follows a question is news; a question that follows a question is not.
    return was === 'attention' && after.status !== 'errored' ? null : 'needs-attention'
  }
  return was === 'working' && (is === 'idle' || is === 'finished') ? 'finished' : null
}
