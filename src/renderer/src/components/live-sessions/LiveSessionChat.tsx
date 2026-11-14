import { useMemo } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { NativeChatMessageList } from '../native-chat/NativeChatMessageList'
import { NativeChatApprovalCard } from '../native-chat/prompts/NativeChatApprovalCard'
import type { NativeChatDeliveryNotice } from '../native-chat/messages/rows/NativeChatMessageRow'
import type { NativeChatLiveSession } from '../native-chat/session/terminal/read/native-chat-live-session-contract'
import type { NativeChatOlderPageResult } from '../native-chat/viewport/history/native-chat-pagination'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import type { LiveTranscriptState } from './use-live-transcript'
import type { PendingRow } from './live-session-pending-rows'
import { LiveSessionComposer } from './LiveSessionComposer'
import { liveSessionStatusGroup } from '../../../../shared/live-sessions/live-session-status'
import { liveMessageStateLabel } from './live-session-presentation'

export type LiveSessionChatProps = {
  session: LiveSession
  transcript: LiveTranscriptState & { loadEarlier: () => Promise<NativeChatOlderPageResult> }
  pending: readonly PendingRow[]
  onSend: (text: string) => void
  onRetry: (messageId: string) => void
  onAnswer: (optionId: string) => void
  /** The option whose answer is on its way. */
  answering: string | null
  /** Changes when a menu asked to type here; the field takes focus. */
  composerFocus?: number
}

export function LiveSessionChat({
  session,
  transcript,
  pending,
  onSend,
  onRetry,
  onAnswer,
  answering,
  composerFocus
}: LiveSessionChatProps): React.JSX.Element {
  const t = useTranslate()
  // Waiting on its own subagents or background tasks is still the agent's turn.
  const working = liveSessionStatusGroup(session.status) === 'working'
  const chat = useMemo<NativeChatLiveSession>(
    () => ({
      messages: [...transcript.messages, ...pending.map((p) => p.row)],
      agent: session.provider,
      sessionId: session.providerSessionId,
      status:
        transcript.phase === 'error'
          ? 'error'
          : transcript.phase === 'loading'
            ? 'loading'
            : working
              ? 'working'
              : transcript.messages.length || pending.length
                ? 'ready'
                : 'empty',
      error: transcript.error ?? undefined,
      readPhase:
        transcript.phase === 'loading'
          ? 'loading'
          : transcript.phase === 'error'
            ? 'error'
            : 'ready',
      hasMore: transcript.hasMore,
      loadingEarlier: transcript.loadingEarlier,
      olderHistoryGeneration: 0,
      loadEarlier: transcript.loadEarlier
    }),
    [session.provider, session.providerSessionId, working, transcript, pending]
  )
  const notices = useMemo(() => {
    const map = new Map<string, NativeChatDeliveryNotice>()
    for (const { row, message } of pending) {
      if (message.state === 'failed') {
        map.set(row.id, {
          text: liveMessageStateLabel(message),
          onSend: () => onRetry(message.messageId)
        })
      } else if (message.state !== 'delivered') {
        map.set(row.id, { sending: true })
      }
    }
    return map
  }, [pending, onRetry])

  const unavailableHint =
    session.inputRoutes.length > 0
      ? null
      : t(
          'auto.components.live-sessions.LiveSessionChat.noRouteTakeOver',
          'Seal can’t type into this session: it runs outside tmux and a Seal pane. Take it over, or install shell integration (Settings › Agents) for next time.'
        )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <NativeChatMessageList
          session={chat}
          isWorking={working}
          expandSignal={false}
          deliveryNotices={notices}
        />
      </div>
      {session.permission ? (
        <NativeChatApprovalCard
          approval={{
            title: session.permission.question,
            options: session.permission.options.map((option) => ({
              label: option.label,
              send: option.id
            }))
          }}
          onChoose={onAnswer}
          isSubmitting={answering !== null}
          submittingOption={answering ?? undefined}
          placement="stacked"
        />
      ) : (
        <LiveSessionComposer
          onSend={onSend}
          unavailableHint={unavailableHint}
          focusSignal={composerFocus}
        />
      )}
    </div>
  )
}
