import { useEffect } from 'react'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { useSessionRecap, type SessionRecapModel } from '../../session-recap/use-session-recap'

/**
 * Reads a session's recap while its chat shows. Reading counts as a visit (it moves "since you last
 * looked" and may start a pass), so a chat kept behind another tab mounts none and keeps what it had.
 */
export function AgentSessionRecapReader({
  session,
  onModel
}: {
  session: Pick<LiveSession, 'id' | 'recap'>
  onModel: (model: SessionRecapModel) => void
}): null {
  const { view, refreshing, failed, refresh, mark } = useSessionRecap(session.id, session.recap)
  useEffect(() => {
    // A reader that has no answer yet leaves the last one showing.
    if (view !== null) {
      onModel({ view, refreshing, failed, refresh, mark })
    }
  }, [onModel, view, refreshing, failed, refresh, mark])
  return null
}
