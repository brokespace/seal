import { Text, View } from 'react-native'
import { AgentStateDot } from '../../components/AgentStateDot'
import {
  LIST_LEADING_INSET,
  ListGroup,
  ListRow,
  SectionHeader
} from '../../components/list/ListGroup'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { sealStyles } from '../seal-screen-styles'
import { SessionRecapCounts } from '../session-recap/SessionRecapCounts'
import {
  groupLiveSessions,
  liveSessionDotState,
  liveSessionProviderLabel,
  liveSessionStatusLabel,
  liveSessionTitle
} from './live-session-presentation'
import type { LiveSession } from './live-session-schemas'

export function LiveSessionRow({
  session,
  onPress
}: {
  session: LiveSession
  onPress: (session: LiveSession) => void
}) {
  const t = useMobileTranslation()
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
      value={
        session.origin === 'external' ? t('seal.liveSessions.external', 'External') : undefined
      }
      accessory={
        session.recap ? (
          <SessionRecapCounts questions={session.recap.questions} actions={session.recap.actions} />
        ) : undefined
      }
      navigates
      onPress={() => onPress(session)}
    />
  )
}

const NO_HOST_ERRORS: Record<string, string> = {}

/** Sessions under a header per machine and a label per project folder. */
export function LiveSessionGroups({
  sessions,
  hostErrors = NO_HOST_ERRORS,
  onOpen
}: {
  sessions: readonly LiveSession[]
  hostErrors?: Record<string, string>
  onOpen: (session: LiveSession) => void
}) {
  const groups = groupLiveSessions(sessions)
  const unlisted = Object.entries(hostErrors).filter(
    ([hostId]) => !groups.some((group) => group.hostId === hostId)
  )
  return (
    <>
      {groups.map((machine, index) => (
        <View key={machine.hostId}>
          <SectionHeader title={machine.label} first={index === 0} />
          {hostErrors[machine.hostId] ? (
            <Text style={[sealStyles.hint, sealStyles.errorText]}>
              {hostErrors[machine.hostId]}
            </Text>
          ) : null}
          {machine.projects.map((project) => (
            <View key={project.key} style={sealStyles.group}>
              <Text style={sealStyles.groupLabel} numberOfLines={1}>
                {project.label}
              </Text>
              <ListGroup separatorInset={LIST_LEADING_INSET}>
                {project.sessions.map((session) => (
                  <LiveSessionRow key={session.id} session={session} onPress={onOpen} />
                ))}
              </ListGroup>
            </View>
          ))}
        </View>
      ))}
      {unlisted.map(([hostId, error], index) => (
        <View key={hostId}>
          <SectionHeader title={hostId} first={groups.length === 0 && index === 0} />
          <Text style={[sealStyles.hint, sealStyles.errorText]}>{error}</Text>
        </View>
      ))}
    </>
  )
}
