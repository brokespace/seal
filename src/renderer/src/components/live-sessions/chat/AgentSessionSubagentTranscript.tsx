import { useMemo } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import {
  subagentTranscriptId,
  type LiveSubagent
} from '../../../../../shared/live-sessions/live-session-activity'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { NativeChatMessageList } from '../../native-chat/NativeChatMessageList'
import type { NativeChatLiveSession } from '../../native-chat/session/terminal/read/native-chat-live-session-contract'
import { useLiveTranscript } from '../use-live-transcript'
import { LiveTranscriptImagesContext } from './use-live-transcript-image'

/** A subagent's own transcript, read-only, in place of its session's chat. */
export function AgentSessionSubagentTranscript({
  session,
  subagent,
  isVisible,
  onBack,
  className
}: {
  session: LiveSession
  subagent: LiveSubagent
  isVisible: boolean
  onBack: () => void
  className?: string
}): React.JSX.Element {
  const t = useTranslate()
  const transcriptId = subagentTranscriptId(session.id, subagent.id)
  const { phase, error, messages, hasMore, loadingEarlier, loadEarlier, retainHistory } =
    useLiveTranscript(transcriptId)
  const chat = useMemo<NativeChatLiveSession>(() => {
    const ready = messages.length ? 'ready' : 'empty'
    return {
      messages,
      agent: session.provider,
      sessionId: session.providerSessionId,
      status: phase === 'ready' ? ready : phase,
      error: error ?? undefined,
      readPhase: phase,
      hasMore,
      loadingEarlier,
      olderHistoryGeneration: 0,
      loadEarlier,
      retainHistory
    }
  }, [
    session.provider,
    session.providerSessionId,
    phase,
    error,
    messages,
    hasMore,
    loadingEarlier,
    loadEarlier,
    retainHistory
  ])
  return (
    <div className={cn('flex min-h-0 min-w-0 flex-col bg-chat-pane', className)}>
      <div
        data-live-subagent-transcript={subagent.id}
        className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5"
      >
        <Button type="button" variant="ghost" size="xs" onClick={onBack}>
          <ArrowLeft className="size-3.5" />
          {t('auto.components.live-sessions.workspace.backToSession', 'Back to session')}
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {t('auto.components.live-sessions.workspace.subagentOf', 'Subagent: {{title}}', {
            title: subagent.title
          })}
        </span>
      </div>
      <LiveTranscriptImagesContext value={transcriptId}>
        <NativeChatMessageList
          session={chat}
          isVisible={isVisible}
          isWorking={false}
          expandSignal={false}
          // No workspace owns these rows: images the transcript holds draw, files they name stay labels.
          runtimeContext={null}
        />
      </LiveTranscriptImagesContext>
    </div>
  )
}
