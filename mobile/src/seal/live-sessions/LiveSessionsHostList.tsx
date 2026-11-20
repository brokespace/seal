import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, Text } from 'react-native'
import { Radio } from 'lucide-react-native'
import {
  MobileLoadErrorState,
  MobileOfflineState,
  MobileStateView
} from '../../components/MobileStateView'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { liveSessionsNeedingAttention } from '../../../../src/shared/live-sessions/live-session-summary'
import { pressedStyle } from '../../theme/mobile-theme'
import { useHostClient } from '../../transport/connection/host-client-hooks'
import { sealStyles } from '../seal-screen-styles'
import { useSealHostName } from '../SealScreenFrame'
import { liveSessionFinished } from './live-session-presentation'
import { liveSessionPlaceResolver, useKnownSessionWorkspaces } from './live-session-workspace-place'
import { useLiveSessionsFeed } from './live-sessions-feed'
import { LiveSessionsNeedingYou, LiveSessionWorkspaceGroups } from './LiveSessionWorkspaceGroups'
import type { LiveSession } from './live-session-schemas'
import { useOpenLiveSession } from './use-open-live-session'

/** Opens a desktop's sessions from any list: its chat in its workspace, else the registry's chat. */
export function useLiveSessionOpener(hostId: string) {
  const { client, state } = useHostClient(hostId)
  const connected = state === 'connected'
  const workspaces = useKnownSessionWorkspaces(hostId, client, connected)
  return { client, connected, workspaces, ...useOpenLiveSession(hostId, client, workspaces) }
}

/** One desktop's live-session registry: the list its sidebar shows, remote machines included. */
export function useLiveSessionsHost(hostId: string) {
  const { client, connected, workspaces, open, openingId } = useLiveSessionOpener(hostId)
  const feed = useLiveSessionsFeed(client)
  const placeOf = useMemo(() => liveSessionPlaceResolver(workspaces), [workspaces])
  return { feed, connected, placeOf, open, openingId }
}

const rowsAsIs = (rows: ReactNode) => rows

/** What needs the person first, then every session by project and workspace, as on desktop. */
export function LiveSessionsHostList({
  hostId,
  host,
  sessions,
  first = true,
  wrapRows = rowsAsIs
}: {
  hostId: string
  host: ReturnType<typeof useLiveSessionsHost>
  /** The sessions to list, when not all of the feed's: another paired desktop may own some. */
  sessions?: readonly LiveSession[]
  /** The list sits right under the screen's top. */
  first?: boolean
  /** Holds the rows, e.g. in a scroll view; the offline, loading and empty states fill the screen instead. */
  wrapRows?: (rows: ReactNode) => ReactNode
}) {
  const t = useMobileTranslation()
  const hostName = useSealHostName(hostId)
  const [showFinished, setShowFinished] = useState(false)
  const { feed, connected, placeOf, open, openingId } = host
  const listed = sessions ?? feed.sessions
  const finished = listed.filter(liveSessionFinished)
  const shown = showFinished ? listed : listed.filter((s) => !liveSessionFinished(s))
  const attention = liveSessionsNeedingAttention(shown)

  const placeholder = liveSessionsPlaceholder(feed, listed.length, connected, hostName, t)
  if (placeholder) {
    return placeholder
  }
  return wrapRows(
    <>
      {feed.error ? (
        <Text style={[sealStyles.hint, sealStyles.errorText]}>{feed.error}</Text>
      ) : null}
      <LiveSessionsNeedingYou attention={attention} openingId={openingId} onOpen={open} />
      <LiveSessionWorkspaceGroups
        sessions={shown}
        placeOf={placeOf}
        hostErrors={feed.hostErrors}
        first={first && attention.length === 0}
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
    </>
  )
}

function liveSessionsPlaceholder(
  feed: ReturnType<typeof useLiveSessionsFeed>,
  listedCount: number,
  connected: boolean,
  hostName: string,
  t: ReturnType<typeof useMobileTranslation>
) {
  if (!feed.loaded && !connected) {
    return <MobileOfflineState hostName={hostName} />
  }
  if (!feed.loaded && feed.error) {
    return <MobileLoadErrorState error={feed.error} onRetry={() => void feed.refresh()} />
  }
  if (!feed.loaded) {
    return <MobileStateView loading title={t('seal.liveSessions.loading', 'Loading sessions')} />
  }
  if (listedCount === 0 && Object.keys(feed.hostErrors).length === 0) {
    return (
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
  return null
}
