import { Text, View } from 'react-native'
import {
  groupLiveSessionsByWorkspace,
  type LiveSessionPlace
} from '../../../../src/shared/live-sessions/live-session-workspace-groups'
import {
  LIST_LEADING_INSET,
  LIST_ROW_PADDING,
  ListGroup,
  SectionHeader
} from '../../components/list/ListGroup'
import { TailClippedText } from '../../components/TailClippedText'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, radii, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { sealStyles } from '../seal-screen-styles'
import type { LiveSession } from './live-session-schemas'
import { LiveSessionRow } from './LiveSessionRow'

type RowProps = {
  /** The session whose chat is being found on the host. */
  openingId: string | null
  onOpen: (session: LiveSession) => void
}

/** The sessions waiting on the person, above every other list of them. Nothing when none waits. */
export function LiveSessionsNeedingYou({
  attention,
  openingId,
  onOpen
}: RowProps & {
  /** `liveSessionsNeedingAttention` of the sessions listed below. */
  attention: readonly LiveSession[]
}) {
  const t = useMobileTranslation()
  if (attention.length === 0) {
    return null
  }
  return (
    <View testID="live-sessions-needs-you">
      <SectionHeader
        title={t('seal.overview.attention', 'Needs you')}
        trailing={String(attention.length)}
        first
      />
      <ListGroup separatorInset={LIST_LEADING_INSET} style={sealStyles.group}>
        {attention.map((session) => (
          <LiveSessionRow
            key={session.id}
            session={session}
            listTestId="live-session-needs-you-row"
            opening={openingId === session.id}
            onPress={onOpen}
          />
        ))}
      </ListGroup>
    </View>
  )
}

const NO_HOST_ERRORS: Record<string, string> = {}

/** Sessions under a header per project and, within it, per workspace with its machine as a badge. */
export function LiveSessionWorkspaceGroups({
  sessions,
  placeOf,
  hostErrors = NO_HOST_ERRORS,
  first = false,
  openingId,
  onOpen
}: RowProps & {
  sessions: readonly LiveSession[]
  placeOf: (session: LiveSession) => LiveSessionPlace
  /** Machines whose sessions could not be read, by host id. */
  hostErrors?: Record<string, string>
  /** The first project sits right under the screen's top or another header. */
  first?: boolean
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const projects = groupLiveSessionsByWorkspace(sessions, placeOf)
  const machineLabel = (hostId: string) =>
    sessions.find((session) => session.machine.hostId === hostId)?.machine.label ?? hostId
  return (
    <>
      {Object.entries(hostErrors).map(([hostId, error]) => (
        <Text
          key={hostId}
          style={[sealStyles.hint, sealStyles.errorText]}
          testID="live-session-machine-error"
        >
          {`${machineLabel(hostId)}: ${error}`}
        </Text>
      ))}
      {projects.map((project, index) => (
        <View key={project.key} testID="live-session-project">
          <SectionHeader
            title={project.label ?? t('seal.liveSessions.noProject', 'No project')}
            first={first && index === 0}
          />
          {project.workspaces.map((workspace) => (
            <View key={workspace.key} style={sealStyles.group} testID="live-session-workspace">
              <View style={styles.workspace}>
                <View style={styles.workspaceName}>
                  {workspace.label ? (
                    <TailClippedText style={styles.workspaceLabel}>
                      {workspace.label}
                    </TailClippedText>
                  ) : null}
                </View>
                <View style={styles.machine} testID="live-session-machine-badge">
                  <Text style={styles.machineLabel} numberOfLines={1}>
                    {workspace.machine.label}
                  </Text>
                </View>
              </View>
              <ListGroup separatorInset={LIST_LEADING_INSET}>
                {workspace.sessions.map((session) => (
                  <LiveSessionRow
                    key={session.id}
                    session={session}
                    listTestId="live-session-row"
                    opening={openingId === session.id}
                    onPress={onOpen}
                  />
                ))}
              </ListGroup>
            </View>
          ))}
        </View>
      ))}
    </>
  )
}

const styles = themedStyleSheet(() => ({
  workspace: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: LIST_ROW_PADDING,
    paddingVertical: spacing.xs
  },
  workspaceName: { flex: 1, minWidth: 0 },
  workspaceLabel: { fontSize: typography.metaSize, color: colors.textMuted },
  machine: {
    flexShrink: 0,
    maxWidth: '45%',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.translucentFill
  },
  machineLabel: { fontSize: 11, fontWeight: '600', color: colors.textSecondary }
}))
