import { useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Radio } from 'lucide-react-native'
import {
  MobileLoadErrorState,
  MobileOfflineState,
  MobileStateView
} from '../../components/MobileStateView'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { liveSessionsNeedingAttention } from '../../../../src/shared/live-sessions/live-session-summary'
import { colors, pressedStyle, spacing } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { useHostClient } from '../../transport/connection/host-client-hooks'
import { sealStyles } from '../seal-screen-styles'
import { SealScreenFrame, useSealHostName } from '../SealScreenFrame'
import { liveSessionFinished } from './live-session-presentation'
import { liveSessionPlaceResolver, useKnownSessionWorkspaces } from './live-session-workspace-place'
import { useLiveSessionsFeed } from './live-sessions-feed'
import { LiveSessionsNeedingYou, LiveSessionWorkspaceGroups } from './LiveSessionWorkspaceGroups'
import { useOpenLiveSession } from './use-open-live-session'

/** Every agent session the host sees: what needs the person first, then all of them by project and workspace. */
export function LiveSessionsScreen({ hostId }: { hostId: string }) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const insets = useSafeAreaInsets()
  const hostName = useSealHostName(hostId)
  const { client, state } = useHostClient(hostId)
  const feed = useLiveSessionsFeed(client)
  const [showFinished, setShowFinished] = useState(false)
  const [pulling, setPulling] = useState(false)
  const connected = state === 'connected'
  const workspaces = useKnownSessionWorkspaces(hostId, client, connected)
  const placeOf = useMemo(() => liveSessionPlaceResolver(workspaces), [workspaces])
  const { open, openingId } = useOpenLiveSession(hostId, client, workspaces)

  const finished = feed.sessions.filter(liveSessionFinished)
  const shown = showFinished ? feed.sessions : feed.sessions.filter((s) => !liveSessionFinished(s))
  const attention = liveSessionsNeedingAttention(shown)

  let body
  if (!feed.loaded && !connected) {
    body = <MobileOfflineState hostName={hostName} />
  } else if (!feed.loaded && feed.error) {
    body = <MobileLoadErrorState error={feed.error} onRetry={() => void feed.refresh()} />
  } else if (!feed.loaded) {
    body = <MobileStateView loading title={t('seal.liveSessions.loading', 'Loading sessions')} />
  } else if (feed.sessions.length === 0 && Object.keys(feed.hostErrors).length === 0) {
    body = (
      <MobileStateView
        icon={Radio}
        title={t('seal.liveSessions.emptyTitle', 'No agent sessions')}
        message={t(
          'seal.liveSessions.emptyMessage',
          'Chats and agent sessions on this computer and its SSH hosts show up here.'
        )}
      />
    )
  }

  return (
    <SealScreenFrame hostId={hostId} title={t('seal.liveSessions.title', 'Live sessions')}>
      {body ?? (
        <ScrollView
          contentContainerStyle={[sealStyles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
          refreshControl={
            <RefreshControl
              refreshing={pulling && connected}
              tintColor={colors.textSecondary}
              onRefresh={() => {
                setPulling(true)
                void feed.refresh().finally(() => setPulling(false))
              }}
            />
          }
        >
          {feed.error ? (
            <Text style={[sealStyles.hint, sealStyles.errorText]}>{feed.error}</Text>
          ) : null}
          <LiveSessionsNeedingYou attention={attention} openingId={openingId} onOpen={open} />
          <LiveSessionWorkspaceGroups
            sessions={shown}
            placeOf={placeOf}
            hostErrors={feed.hostErrors}
            first={attention.length === 0}
            openingId={openingId}
            onOpen={open}
          />
          {finished.length > 0 ? (
            <Pressable
              style={({ pressed }) => [sealStyles.textButton, pressed && pressedStyle]}
              onPress={() => setShowFinished(!showFinished)}
              accessibilityRole="button"
            >
              <Text style={sealStyles.textButtonLabel}>
                {showFinished
                  ? t('seal.liveSessions.hideFinished', 'Hide finished sessions')
                  : t('seal.liveSessions.showFinished', 'Show {{value0}} finished', {
                      value0: finished.length
                    })}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </SealScreenFrame>
  )
}
