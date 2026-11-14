import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Radio } from 'lucide-react-native'
import {
  MobileLoadErrorState,
  MobileOfflineState,
  MobileStateView
} from '../../components/MobileStateView'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { useRouteHandoff } from '../../navigation/route-handoff'
import { colors, pressedStyle, spacing } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { useHostClient } from '../../transport/connection/host-client-hooks'
import { sealSessionHref } from '../seal-route-hrefs'
import { sealStyles } from '../seal-screen-styles'
import { SealScreenFrame, useSealHostName } from '../SealScreenFrame'
import { liveSessionFinished } from './live-session-presentation'
import { LiveSessionGroups } from './LiveSessionRow'
import { useLiveSessionsFeed } from './live-sessions-feed'

/** Every agent session the host sees, Seal's and external ones, by machine and project. */
export function LiveSessionsScreen({ hostId }: { hostId: string }) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const router = useRouteHandoff()
  const insets = useSafeAreaInsets()
  const hostName = useSealHostName(hostId)
  const { client, state } = useHostClient(hostId)
  const feed = useLiveSessionsFeed(client)
  const [showFinished, setShowFinished] = useState(false)
  const [pulling, setPulling] = useState(false)
  const connected = state === 'connected'

  const finished = feed.sessions.filter(liveSessionFinished)
  const shown = showFinished ? feed.sessions : feed.sessions.filter((s) => !liveSessionFinished(s))

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
          'Claude Code and Codex sessions on this computer and its SSH hosts show up here.'
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
          <LiveSessionGroups
            sessions={shown}
            hostErrors={feed.hostErrors}
            onOpen={(session) => router.push(sealSessionHref(hostId, session.id))}
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
