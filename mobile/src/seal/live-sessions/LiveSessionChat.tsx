import { useCallback, useMemo } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { liveSessionStatusGroup } from '../../../../src/shared/live-sessions/live-session-status'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import {
  editMobileNativeChatDraft,
  setMobileNativeChatDraftText
} from '../../session/native-chat/composer/mobile-native-chat-draft-store'
import type { MobileChatPermission } from '../../session/native-chat/input/mobile-native-chat-permission'
import type { MobileChatQuestion } from '../../session/native-chat/input/mobile-native-chat-question'
import {
  MobileNativeChatView,
  type MobileNativeChatInputLockReason
} from '../../session/native-chat/MobileNativeChatView'
import { MobileNativeChatHistoryRetentionContext } from '../../session/native-chat/transcript/mobile-native-chat-history-retention-context'
import { MobileNativeChatNoticeContext } from '../../session/native-chat/transcript/mobile-native-chat-notice-context'
import {
  MobileNativeChatReplyRevealsContext,
  useMobileNativeChatReplyReveals
} from '../../session/native-chat/transcript/mobile-native-chat-reply-reveals'
import { MobileNativeChatRowOverlaysHost } from '../../session/native-chat/transcript/MobileNativeChatRowOverlaysHost'
import { useMobileNativeChatProjection } from '../../session/native-chat/transcript/use-mobile-native-chat-projection'
import { useMobileSessionKeyboardLift } from '../../terminal/session/input-controls/use-mobile-session-keyboard-lift'
import type { ConnectionState } from '../../transport/connection/connection-state'
import { canTakeOverLiveSession, liveSessionProviderLabel } from './live-session-presentation'
import type { LiveMessage } from './live-session-schemas'
import { LiveSessionUndeliveredSends } from './LiveSessionUndeliveredSends'
import type { LiveSessionChatSource } from './use-live-session-chat-source'

const NO_GENERATION = () => 0

/**
 * A session the registry holds, in the one chat view: its transcript, the outbox, its prompt and a
 * composer, all from `source`. The view is the workspace chat's; nothing here draws a row.
 */
export function LiveSessionChat({
  surfaceId,
  hostName,
  connection,
  sessionsRead,
  source,
  onRetry
}: {
  /**
   * Names this chat's draft and view state. More than three `\0` parts: the draft store saves a
   * workspace tab's three-part scope, and this one stays in memory.
   */
  surfaceId: string
  hostName: string
  connection: ConnectionState
  /** The session list has been read, so a missing record means the session ended. */
  sessionsRead: boolean
  source: LiveSessionChatSource
  /** Sends an undelivered message again; the screen asks first when that could run it twice. */
  onRetry: (message: LiveMessage) => void
}) {
  const t = useMobileTranslation()
  const insets = useSafeAreaInsets()
  const keyboardInset = useMobileSessionKeyboardLift(insets.bottom)
  const { sessionId, session, messages, prompt, answer, composer } = source
  const connected = connection === 'connected'
  const agent = session?.provider ?? ''

  const folded = useMobileNativeChatProjection(messages.messages, agent, [surfaceId], true)
  const replyReveals = useMobileNativeChatReplyReveals(folded, false, surfaceId)
  const notice = useMemo(
    () => ({
      hostName: hostName || null,
      ...(agent ? { agentName: liveSessionProviderLabel({ provider: agent }) } : {})
    }),
    [hostName, agent]
  )

  const sent = source.pending.list
  const pending = sent
    .filter((message) => message.state !== 'failed')
    .map((message) => ({
      id: `live-pending:${message.messageId}`,
      text: message.text,
      sentAt: message.createdAt
    }))
  const undelivered = sent.filter((message) => message.state === 'failed')

  const send = composer.send
  const onSend = useCallback(
    async (text: string): Promise<boolean> => {
      send(text)
      // The view leaves the draft to whoever takes the send.
      setMobileNativeChatDraftText(surfaceId, (current) => (current === text ? '' : current))
      return true
    },
    [send, surfaceId]
  )
  const onComposerTextChange = useCallback(
    (text: string) => editMobileNativeChatDraft(surfaceId, text),
    [surfaceId]
  )

  const options = source.capabilities.answer ? (prompt?.options ?? []) : []
  // A prompt no option can answer shows no card, so the composer stays free to type the answer.
  const card = prompt && options.length > 0 ? prompt : null
  const asksQuestion = session?.status === 'waiting-input'
  const question = useMemo<MobileChatQuestion | null>(
    () =>
      card && asksQuestion
        ? {
            question: card.question,
            options: card.options.map((option) => option.label),
            optionTokens: card.options.map((option) => option.id),
            multiSelect: false,
            allowOther: false
          }
        : null,
    [card, asksQuestion]
  )
  const permission = useMemo<MobileChatPermission | null>(
    () =>
      card && !asksQuestion
        ? {
            title: card.question,
            options: card.options.map((option) => ({ label: option.label, send: option.id })),
            neutralOptions: true
          }
        : null,
    [card, asksQuestion]
  )

  let inputLockReason: MobileNativeChatInputLockReason | null = null
  let inputLockText: string | null = null
  if (!connected) {
    inputLockReason = 'disconnected'
  } else if (!session?.alive) {
    inputLockReason = 'waiting'
    inputLockText =
      session || sessionsRead
        ? t('seal.liveSessions.ended', 'This session is no longer running.')
        : t('seal.liveSessions.loading', 'Loading sessions')
  } else if (!source.capabilities.send) {
    inputLockReason = 'waiting'
    inputLockText = canTakeOverLiveSession(session)
      ? t(
          'seal.liveSessions.noRouteTakeOver',
          'Seal can’t type into this session: it runs outside tmux and a Seal pane. Take it over to reply.'
        )
      : t('seal.liveSessions.noRoute', 'Seal can’t type into this session.')
  }
  const hostOutage = connected
    ? null
    : {
        text:
          connection === 'disconnected'
            ? t('connection.connectionHealth.hostOffline', '{{host}} is offline', {
                host: hostName
              })
            : t('chat.hostOutage.reconnecting', '{{hostName}} is reconnecting…', { hostName })
      }

  return (
    <MobileNativeChatRowOverlaysHost
      conversation={{ surfaceId, sessionId }}
      imageSource={source.images}
    >
      <MobileNativeChatReplyRevealsContext.Provider value={replyReveals}>
        <MobileNativeChatNoticeContext.Provider value={notice}>
          <MobileNativeChatHistoryRetentionContext.Provider value={messages.retainHistory}>
            <MobileNativeChatView
              messages={messages.messages}
              folded={folded}
              status={messages.phase === 'loading' ? 'loading' : 'ready'}
              agent={agent || null}
              sessionLive={session?.alive === true}
              // A prompt holds the turn open: its tool call has not run yet.
              agentWorking={
                session?.alive === true &&
                (liveSessionStatusGroup(session.status) === 'working' || card !== null)
              }
              // The registry has no call that stops a turn.
              canStop={false}
              streaming={null}
              hasMore={messages.hasMore}
              olderPages={messages.olderPages}
              onLoadEarlier={() => void messages.loadEarlier()}
              onSend={onSend}
              sendSurfaceId={surfaceId}
              getSendCompletionGeneration={NO_GENERATION}
              getComposerEditGeneration={NO_GENERATION}
              pending={pending}
              draftKey={surfaceId}
              composerScopeKey={surfaceId}
              onComposerTextChange={onComposerTextChange}
              inputLockReason={inputLockReason}
              inputLockText={inputLockText}
              hostOutage={hostOutage}
              sendErrorMessage={source.answerError}
              onClearSendError={source.clearAnswerError}
              onDismissSendError={source.clearAnswerError}
              contextUsage={session?.context ?? null}
              permission={permission}
              onRespondPermission={answer}
              question={question}
              onAnswerQuestion={answer}
              promptKey={card?.promptId ?? null}
              composerTray={{
                content: (
                  <LiveSessionUndeliveredSends
                    messages={undelivered}
                    onRetry={connected ? onRetry : null}
                  />
                )
              }}
              keyboardInset={keyboardInset}
            />
          </MobileNativeChatHistoryRetentionContext.Provider>
        </MobileNativeChatNoticeContext.Provider>
      </MobileNativeChatReplyRevealsContext.Provider>
    </MobileNativeChatRowOverlaysHost>
  )
}
