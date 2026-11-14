import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeftRight, UserRound } from 'lucide-react-native'
import { ConfirmModal } from '../../components/ConfirmModal'
import { NavBarButton } from '../../components/nav-bar/NavBarButton'
import {
  MobileLoadErrorState,
  MobileOfflineState,
  MobileStateView
} from '../../components/MobileStateView'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { useKeyboardOcclusion } from '../../platform/keyboard/keyboard-occlusion'
import { colors, pressedStyle, spacing } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { useHostClient } from '../../transport/connection/host-client-hooks'
import { sealAssignmentForLiveSession } from '../accounts/seal-account-presentation'
import { SealSessionAccountSheet } from '../accounts/SealSessionAccountSheet'
import { useSealAccounts } from '../accounts/use-seal-accounts'
import { sealStyles } from '../seal-screen-styles'
import { SealScreenFrame, useSealHostName } from '../SealScreenFrame'
import { answerLivePermission, takeOverLiveSession } from './live-session-operations'
import {
  canTakeOverLiveSession,
  liveSessionAcceptsInput,
  liveSessionProviderLabel,
  liveSessionStatusLabel,
  liveSessionResumeCommand,
  liveSessionTitle,
  liveTakeOverFailureText
} from './live-session-presentation'
import type { LiveMessage, LiveSession, LiveTranscriptMessage } from './live-session-schemas'
import { currentLiveSessionId, useLiveSessionsFeed } from './live-sessions-feed'
import { LivePermissionCard } from './LivePermissionCard'
import { LiveSessionComposer } from './LiveSessionComposer'
import { LivePendingRow, LiveTranscriptRow } from './LiveTranscriptRow'
import { useLiveSessionOutbox } from './use-live-session-outbox'
import { useLiveTranscript } from './use-live-transcript'

type Row =
  | { kind: 'transcript'; key: string; message: LiveTranscriptMessage }
  | { kind: 'pending'; key: string; message: LiveMessage }

const AT_BOTTOM_SLOP = 48
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** One session's transcript, live, with a composer, its permission prompt, and account and take-over actions. */
export function LiveSessionDetailScreen({
  hostId,
  sessionId: routeSessionId
}: {
  hostId: string
  sessionId: string
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const insets = useSafeAreaInsets()
  const keyboardHeight = useKeyboardOcclusion()
  const hostName = useSealHostName(hostId)
  const { client, state } = useHostClient(hostId)
  const connected = state === 'connected'
  const feed = useLiveSessionsFeed(client)
  const sessionId = currentLiveSessionId(feed, routeSessionId)
  const session = feed.sessions.find((entry) => entry.id === sessionId) ?? null
  const transcript = useLiveTranscript(client, sessionId)
  const accounts = useSealAccounts(hostId, client, false)
  const assignment = session ? sealAssignmentForLiveSession(accounts.status, session) : null

  const [answering, setAnswering] = useState<string | null>(null)
  const [answerError, setAnswerError] = useState<string | null>(null)
  const [accountSheetOpen, setAccountSheetOpen] = useState(false)
  const [takeOverAsked, setTakeOverAsked] = useState(false)
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null)

  const list = useRef<FlatList<Row>>(null)
  const atBottom = useRef(true)

  const onSend = useCallback(() => {
    atBottom.current = true
  }, [])
  const { pending, send, retry } = useLiveSessionOutbox({
    client,
    feed,
    sessionId,
    transcript: transcript.messages,
    onSend
  })
  const rows: Row[] = [
    ...transcript.messages.map((message) => ({
      kind: 'transcript' as const,
      key: `t:${message.id}`,
      message
    })),
    ...pending.map((message) => ({
      kind: 'pending' as const,
      key: `p:${message.messageId}`,
      message
    }))
  ]

  const answer = async (session: LiveSession, optionId: string) => {
    if (!client || !session.permission) {
      return
    }
    setAnswering(optionId)
    setAnswerError(null)
    try {
      const result = await answerLivePermission(client, {
        sessionId: session.id,
        promptId: session.permission.promptId,
        optionId
      })
      if (!result.ok) {
        setAnswerError(
          result.error ??
            t('seal.liveSessions.answerFailed', 'The session didn’t take that answer.')
        )
      }
    } catch (error) {
      setAnswerError(errorText(error))
    } finally {
      setAnswering(null)
    }
  }

  const takeOver = async (session: LiveSession) => {
    setTakeOverAsked(false)
    if (!client) {
      return
    }
    try {
      const result = await takeOverLiveSession(client, session.id)
      if (result.ok) {
        setNotice({
          title: t('seal.liveSessions.takeOverDoneTitle', 'Session stopped'),
          message: t(
            'seal.liveSessions.takeOverDoneMessage',
            'Seal stopped the agent. Phones can’t open Seal panes, so reopen it on your computer: choose Take over on this session there, or run {{value0}}.',
            {
              value0: liveSessionResumeCommand(
                result.provider ?? session.provider,
                result.providerSessionId ?? session.providerSessionId
              )
            }
          )
        })
        return
      }
      setNotice({
        title: t('seal.liveSessions.takeOverFailedTitle', 'Couldn’t take over'),
        message: liveTakeOverFailureText(result.reason, result.error)
      })
    } catch (error) {
      setNotice({
        title: t('seal.liveSessions.takeOverFailedTitle', 'Couldn’t take over'),
        message: errorText(error)
      })
    }
  }

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    atBottom.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - AT_BOTTOM_SLOP
  }

  const title = session ? liveSessionTitle(session) : t('seal.liveSessions.session', 'Session')
  const subtitle = session
    ? [
        liveSessionProviderLabel(session),
        session.machine.label,
        liveSessionStatusLabel(session.status)
      ].join(' · ')
    : undefined

  const trailing = session ? (
    <View style={styles.actions}>
      {assignment ? (
        <NavBarButton
          icon={UserRound}
          onPress={() => setAccountSheetOpen(true)}
          accessibilityLabel={t('seal.liveSessions.account', 'Session account')}
        />
      ) : null}
      {canTakeOverLiveSession(session) && session.alive ? (
        <NavBarButton
          icon={ArrowLeftRight}
          onPress={() => setTakeOverAsked(true)}
          accessibilityLabel={t('seal.liveSessions.takeOverButton', 'Take over')}
          disabled={!connected}
        />
      ) : null}
    </View>
  ) : null

  let body
  if (transcript.phase === 'loading' && !connected) {
    body = <MobileOfflineState hostName={hostName} />
  } else if (transcript.phase === 'error' && transcript.messages.length === 0) {
    body = (
      <MobileLoadErrorState
        error={
          transcript.error ??
          t('seal.liveSessions.transcriptError', 'Couldn’t read the transcript.')
        }
        onRetry={transcript.retry}
      />
    )
  } else if (transcript.phase === 'loading') {
    body = (
      <MobileStateView
        loading
        title={t('seal.liveSessions.loadingTranscript', 'Loading transcript')}
      />
    )
  } else if (rows.length === 0) {
    body = (
      <MobileStateView
        title={t('seal.liveSessions.emptyTranscript', 'Nothing here yet')}
        message={t(
          'seal.liveSessions.emptyTranscriptMessage',
          'Messages show up as the session writes them.'
        )}
      />
    )
  }

  const composerHint = !session
    ? feed.loaded
      ? t('seal.liveSessions.ended', 'This session is no longer running.')
      : null
    : liveSessionAcceptsInput(session)
      ? null
      : canTakeOverLiveSession(session)
        ? t(
            'seal.liveSessions.noRouteTakeOver',
            'Seal can’t type into this session: it runs outside tmux and a Seal pane. Take it over to reply.'
          )
        : t('seal.liveSessions.noRoute', 'Seal can’t type into this session.')

  return (
    <SealScreenFrame hostId={hostId} title={title} subtitle={subtitle} trailing={trailing}>
      <View style={styles.fill}>
        {body ?? (
          <FlatList
            ref={list}
            data={rows}
            keyExtractor={(row) => row.key}
            contentContainerStyle={styles.listContent}
            onScroll={onScroll}
            scrollEventThrottle={64}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            onContentSizeChange={() => {
              if (atBottom.current) {
                list.current?.scrollToEnd({ animated: false })
              }
            }}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              transcript.hasMore ? (
                <Pressable
                  style={({ pressed }) => [styles.earlier, pressed && pressedStyle]}
                  onPress={() => void transcript.loadEarlier()}
                  disabled={transcript.loadingEarlier}
                  accessibilityRole="button"
                >
                  {transcript.loadingEarlier ? (
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                  ) : (
                    <Text style={sealStyles.textButtonLabel}>
                      {t('seal.liveSessions.loadEarlier', 'Load earlier messages')}
                    </Text>
                  )}
                </Pressable>
              ) : undefined
            }
            renderItem={({ item }) =>
              item.kind === 'transcript' ? (
                <LiveTranscriptRow message={item.message} />
              ) : (
                <LivePendingRow message={item.message} onRetry={connected ? retry : null} />
              )
            }
          />
        )}
      </View>
      <View
        style={
          keyboardHeight > 0 ? { marginBottom: keyboardHeight } : { paddingBottom: insets.bottom }
        }
      >
        {session?.permission ? (
          <LivePermissionCard
            permission={session.permission}
            answering={answering}
            error={answerError}
            onAnswer={(optionId) => void answer(session, optionId)}
          />
        ) : null}
        <LiveSessionComposer hint={composerHint} disabled={!connected || !session} onSend={send} />
      </View>
      <SealSessionAccountSheet
        assignment={accountSheetOpen ? assignment : null}
        status={accounts.status}
        onMutate={(busyKey, mutation) => void accounts.mutate(busyKey, mutation)}
        onClose={() => setAccountSheetOpen(false)}
      />
      <ConfirmModal
        visible={takeOverAsked && session !== null}
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
        onCancel={() => setTakeOverAsked(false)}
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

const styles = themedStyleSheet(() => ({
  fill: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  earlier: { alignItems: 'center', paddingVertical: spacing.md }
}))
