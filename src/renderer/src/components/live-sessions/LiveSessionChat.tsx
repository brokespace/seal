import { useMemo } from 'react'
import { AgentStateDot } from '@/components/AgentStateDot'
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
import { LiveSessionTakeOverButton } from './take-over/LiveSessionTakeOverButton'
import { LiveSessionRemoveButton } from './remove/LiveSessionRemoveButton'
import {
  liveMessageStateLabel,
  liveSessionDotState,
  liveSessionProviderLabel,
  liveSessionStatusLabel,
  liveSessionTitle
} from './live-session-presentation'

export type LiveSessionChatProps = {
  session: LiveSession
  transcript: LiveTranscriptState & { loadEarlier: () => Promise<NativeChatOlderPageResult> }
  pending: readonly PendingRow[]
  onSend: (text: string) => void
  onRetry: (messageId: string) => void
  onAnswer: (optionId: string) => void
  /** The option whose answer is on its way. */
  answering: string | null
}

export function LiveSessionChat({
  session,
  transcript,
  pending,
  onSend,
  onRetry,
  onAnswer,
  answering
}: LiveSessionChatProps): React.JSX.Element {
  const t = useTranslate()
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
            : session.status === 'working'
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
    [session.provider, session.providerSessionId, session.status, transcript, pending]
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
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-chat-pane">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <AgentStateDot state={liveSessionDotState(session.status)} title={null} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-sm font-semibold">{liveSessionTitle(session)}</h2>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="shrink-0">
              {[
                liveSessionProviderLabel(session),
                session.machine.label,
                liveSessionStatusLabel(session.status)
              ].join(' \u00b7 ')}
            </span>
            {session.cwd ? <span className="min-w-0 truncate font-mono">{session.cwd}</span> : null}
          </p>
        </div>
        <LiveSessionTakeOverButton session={session} />
        <LiveSessionRemoveButton session={session} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <NativeChatMessageList
          session={chat}
          isWorking={session.status === 'working'}
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
        <LiveSessionComposer onSend={onSend} unavailableHint={unavailableHint} />
      )}
    </section>
  )
}
