import { AgentStateDot } from '../../components/AgentStateDot'
import { ListRow } from '../../components/list/ListGroup'
import { SessionRecapCounts } from '../session-recap/SessionRecapCounts'
import {
  liveSessionDotState,
  liveSessionProviderLabel,
  liveSessionStatusLabel,
  liveSessionTitle
} from './live-session-presentation'
import type { LiveSession } from './live-session-schemas'

/** `listTestId` names the list a row sits in, so a session listed twice on a screen is told apart. */
export function LiveSessionRow({
  session,
  listTestId,
  opening = false,
  onPress
}: {
  session: LiveSession
  listTestId: string
  /** Its chat is being found on the host. */
  opening?: boolean
  onPress: (session: LiveSession) => void
}) {
  const detail = session.permission?.question ?? session.summary ?? session.statusDetail
  return (
    <ListRow
      title={liveSessionTitle(session)}
      subtitle={[
        liveSessionProviderLabel(session),
        liveSessionStatusLabel(session.status),
        ...(detail ? [detail] : [])
      ].join(' · ')}
      leading={<AgentStateDot state={liveSessionDotState(session.status)} />}
      accessory={<SessionRecapCounts brief={session.recap} />}
      navigates
      busy={opening}
      testID={`${listTestId}-${session.id}`}
      onPress={() => onPress(session)}
    />
  )
}
