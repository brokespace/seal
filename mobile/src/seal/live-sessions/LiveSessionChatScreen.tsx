import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { ArrowLeftRight, Ellipsis, NotebookText, UserRound } from 'lucide-react-native'
import { ActionSheetModal, type ActionSheetAction } from '../../components/ActionSheetModal'
import { ConfirmModal } from '../../components/ConfirmModal'
import { MobileLoadErrorState, MobileOfflineState } from '../../components/MobileStateView'
import { NavBarButton } from '../../components/nav-bar/NavBarButton'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { useHostClient } from '../../transport/connection/host-client-hooks'
import { sealAssignmentForLiveSession } from '../accounts/seal-account-presentation'
import { SealSessionAccountSheet } from '../accounts/SealSessionAccountSheet'
import { useSealAccounts } from '../accounts/use-seal-accounts'
import { SessionRecapOverview } from '../session-recap/SessionRecapOverview'
import { SealScreenFrame, useSealHostName } from '../SealScreenFrame'
import { takeOverLiveSession } from './live-session-operations'
import {
  liveSessionProviderLabel,
  liveSessionResumeCommand,
  liveSessionStatusLabel,
  liveSessionTitle,
  liveTakeOverFailureText
} from './live-session-presentation'
import type { LiveMessage, LiveSession } from './live-session-schemas'
import { useLiveSessionsFeed } from './live-sessions-feed'
import { LiveSessionChat } from './LiveSessionChat'
import { useLiveSessionChatSource } from './use-live-session-chat-source'

type Sheet = 'menu' | 'recap' | 'account' | 'take-over'

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * A CLI or external session as a chat: the workspace chat's view over the registry, with the
 * session's recap, take over and account behind the header's menu.
 */
export function LiveSessionChatScreen({
  hostId,
  sessionId: routeSessionId
}: {
  hostId: string
  sessionId: string
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const hostName = useSealHostName(hostId)
  const { client, state } = useHostClient(hostId)
  const connected = state === 'connected'
  const feed = useLiveSessionsFeed(client)
  const source = useLiveSessionChatSource({ client, feed, sessionId: routeSessionId })
  const { session, messages } = source
  const accounts = useSealAccounts(hostId, client, false)
  const assignment = session ? sealAssignmentForLiveSession(accounts.status, session) : null

  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [resendAsked, setResendAsked] = useState<LiveMessage | null>(null)
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null)
  const closeSheet = () => setSheet(null)

  const takeOver = async (session: LiveSession) => {
    closeSheet()
    if (!client) {
      return
    }
    const failed = (message: string) =>
      setNotice({
        title: t('seal.liveSessions.takeOverFailedTitle', 'Couldn’t take over'),
        message
      })
    try {
      const result = await takeOverLiveSession(client, session.id)
      if (!result.ok) {
        failed(liveTakeOverFailureText(result.reason, result.error))
        return
      }
      const command = liveSessionResumeCommand(
        result.provider ?? session.provider,
        result.providerSessionId ?? session.providerSessionId
      )
      setNotice({
        title: t('seal.liveSessions.takeOverDoneTitle', 'Session stopped'),
        message: command
          ? t(
              'seal.liveSessions.takeOverDoneMessage',
              'Seal stopped the agent. Phones can’t open Seal panes, so reopen it on your computer: choose Take over on this session there, or run {{value0}}.',
              { value0: command }
            )
          : t(
              'seal.liveSessions.takeOverDoneNoCommand',
              'Seal stopped the agent. Phones can’t open Seal panes, so reopen it on your computer: choose Take over on this session there.'
            )
      })
    } catch (error) {
      failed(errorText(error))
    }
  }

  // Each opens another sheet, which iOS presents only once the menu's own is gone.
  const menu: ActionSheetAction[] = [
    ...(session && session.capabilities?.recap !== false
      ? [
          {
            id: 'recap',
            label: t('seal.sessionRecap.title', 'Recap'),
            icon: NotebookText,
            closeBeforePress: true,
            onPress: () => setSheet('recap')
          }
        ]
      : []),
    ...(source.capabilities.takeOver
      ? [
          {
            id: 'take-over',
            label: t('seal.liveSessions.takeOverButton', 'Take over'),
            icon: ArrowLeftRight,
            disabled: !connected,
            closeBeforePress: true,
            onPress: () => setSheet('take-over')
          }
        ]
      : []),
    ...(assignment
      ? [
          {
            id: 'account',
            label: t('seal.liveSessions.account', 'Session account'),
            icon: UserRound,
            closeBeforePress: true,
            onPress: () => setSheet('account')
          }
        ]
      : [])
  ]

  const title = session ? liveSessionTitle(session) : t('seal.liveSessions.session', 'Session')
  const subtitle = session
    ? [
        liveSessionProviderLabel(session),
        session.machine.label,
        liveSessionStatusLabel(session.status)
      ].join(' · ')
    : undefined

  let body
  if (messages.phase === 'loading' && !connected) {
    body = <MobileOfflineState hostName={hostName} />
  } else if (messages.phase === 'error' && messages.messages.length === 0) {
    body = (
      <MobileLoadErrorState
        error={
          messages.error ?? t('seal.liveSessions.transcriptError', 'Couldn’t read the transcript.')
        }
        onRetry={messages.retry}
      />
    )
  }

  return (
    <SealScreenFrame
      hostId={hostId}
      title={title}
      subtitle={subtitle}
      trailing={
        menu.length > 0 ? (
          <NavBarButton
            icon={Ellipsis}
            onPress={() => setSheet('menu')}
            accessibilityLabel={t('seal.liveSessions.actions', 'Session actions')}
          />
        ) : null
      }
    >
      <View style={styles.fill} testID="live-session-chat-screen">
        {body ?? (
          <LiveSessionChat
            // The route's id: the record's own changes when a fresh agent names its session.
            surfaceId={`seal-live-session\0${hostId}\0${routeSessionId}\0chat`}
            hostName={hostName}
            connection={state}
            sessionsRead={feed.loaded}
            source={source}
            onRetry={(message) =>
              message.unconfirmed ? setResendAsked(message) : void source.pending.retry(message)
            }
          />
        )}
      </View>
      <ActionSheetModal
        visible={sheet === 'menu'}
        title={title}
        actions={menu}
        onClose={() => setSheet((shown) => (shown === 'menu' ? null : shown))}
      />
      {session ? (
        <SessionRecapOverview
          client={client}
          sessionId={session.id}
          brief={session.recap}
          open={sheet === 'recap'}
          onClose={closeSheet}
        />
      ) : null}
      <SealSessionAccountSheet
        assignment={sheet === 'account' ? assignment : null}
        status={accounts.status}
        onMutate={(busyKey, mutation) => void accounts.mutate(busyKey, mutation)}
        onClose={closeSheet}
      />
      <ConfirmModal
        visible={sheet === 'take-over' && session !== null}
        title={t('seal.liveSessions.takeOverTitle', 'Take over this session?')}
        message={
          session
            ? t(
                'seal.liveSessions.takeOverMessage',
                'Seal stops {{value0}} on {{value1}} (it ends in the terminal it was started from). A reply in progress stops. Phones can’t open Seal panes, so you finish on your computer.',
                { value0: liveSessionProviderLabel(session), value1: session.machine.label }
              )
            : undefined
        }
        confirmLabel={t('seal.liveSessions.takeOverConfirm', 'Stop and take over')}
        cancelLabel={t('common.cancel', 'Cancel')}
        destructive
        onConfirm={() => session && void takeOver(session)}
        onCancel={closeSheet}
      />
      <ConfirmModal
        visible={resendAsked !== null}
        title={t('seal.liveSessions.resendTitle', 'Send it again?')}
        message={t(
          'seal.liveSessions.resendMessage',
          'Seal could not confirm that the session got this message. It may already have run it, so sending it again could run it twice.'
        )}
        confirmLabel={t('seal.liveSessions.resendConfirm', 'Send again')}
        cancelLabel={t('common.cancel', 'Cancel')}
        onConfirm={() => resendAsked && void source.pending.retry(resendAsked)}
        onCancel={() => setResendAsked(null)}
      />
      <ConfirmModal
        visible={notice !== null || accounts.error !== null}
        title={notice?.title ?? t('seal.accounts.failedTitle', 'Couldn’t change the account')}
        message={notice?.message ?? accounts.error ?? undefined}
        confirmLabel={t('common.ok', 'OK')}
        cancelLabel={null}
        onCancel={() => {
          setNotice(null)
          accounts.clearError()
        }}
      />
    </SealScreenFrame>
  )
}

const styles = StyleSheet.create({ fill: { flex: 1 } })
