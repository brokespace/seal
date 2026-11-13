import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createNonSecureContextUuid } from '../../../../shared/non-secure-context-uuid'
import { useTranslate } from '@/i18n/use-translate'
import type {
  LiveMessage,
  LiveSession,
  LiveSessionRegistrySnapshot
} from '../../../../shared/live-sessions/live-session-types'
import { liveSessionRegistryStore, useLiveSessions } from './live-session-registry-store'
import { useLiveTranscript } from './use-live-transcript'
import { pendingRows } from './live-session-pending-rows'
import { LiveSessionList } from './LiveSessionList'
import { LiveSessionChat } from './LiveSessionChat'

const SEND_ATTEMPTS = 3

/** Sends survive a dropped IPC round trip: the same messageId is idempotent in the outbox. */
async function sendIdempotently(message: LiveMessage): Promise<void> {
  const api = window.api.liveSessions
  for (let attempt = 1; ; attempt++) {
    try {
      liveSessionRegistryStore.upsertMessage(
        await api.send({
          sessionId: message.sessionId,
          messageId: message.messageId,
          text: message.text
        })
      )
      return
    } catch (error) {
      if (attempt >= SEND_ATTEMPTS) {
        liveSessionRegistryStore.upsertMessage({
          ...message,
          state: 'failed',
          error: error instanceof Error ? error.message : String(error),
          updatedAt: Date.now()
        })
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
    }
  }
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(id)
  }, [everyMs])
  return now
}

export type LiveSessionsViewProps = {
  loaded: boolean
  sessions: readonly LiveSession[]
  hostErrors: LiveSessionRegistrySnapshot['hostErrors']
  selectedId: string | null
  onSelect: (sessionId: string) => void
  onRefresh: () => void
  now: number
  chat: React.ReactNode
}

/** The page without its data sources, so fixtures can render it. */
export function LiveSessionsView(props: LiveSessionsViewProps): React.JSX.Element {
  const t = useTranslate()
  return (
    <main className="relative flex h-full min-h-0 flex-1 flex-col bg-background pt-5 text-foreground md:pt-6">
      <header
        className="flex shrink-0 items-center gap-2 px-3 pb-3 md:px-5"
        style={
          { paddingRight: 'max(0.75rem, var(--window-controls-width, 0px))' } as React.CSSProperties
        }
      >
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold leading-8">
          {t('auto.components.live-sessions.LiveSessionsPage.title', 'Agent sessions')}
        </h1>
        <Button type="button" variant="ghost" size="sm" onClick={props.onRefresh}>
          <RefreshCw className="size-4" />
          {t('auto.components.live-sessions.LiveSessionsPage.refresh', 'Scan again')}
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 border-t border-border">
        <aside className="flex w-80 shrink-0 flex-col border-r border-border pt-2">
          {!props.loaded ? (
            <p className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('auto.components.live-sessions.LiveSessionsPage.scanning', 'Looking for sessions')}
            </p>
          ) : props.sessions.length === 0 ? (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              {t(
                'auto.components.live-sessions.LiveSessionsPage.empty',
                'No Claude Code or Codex sessions ran in the last 12 hours on this machine or a connected SSH host.'
              )}
            </p>
          ) : null}
          <LiveSessionList
            sessions={props.sessions}
            hostErrors={props.hostErrors}
            selectedId={props.selectedId}
            onSelect={props.onSelect}
            now={props.now}
          />
        </aside>
        {props.chat ?? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t(
              'auto.components.live-sessions.LiveSessionsPage.pick',
              'Pick a session to open its chat'
            )}
          </div>
        )}
      </div>
    </main>
  )
}

function SelectedSessionChat({
  session,
  messages
}: {
  session: LiveSession
  messages: ReadonlyMap<string, LiveMessage>
}): React.JSX.Element {
  const transcript = useLiveTranscript(session.id)
  const [answering, setAnswering] = useState<string | null>(null)
  const pending = useMemo(
    () =>
      pendingRows(
        transcript.messages,
        [...messages.values()].filter((m) => m.sessionId === session.id)
      ),
    [transcript.messages, messages, session.id]
  )
  const onSend = useCallback(
    (text: string) => {
      const now = Date.now()
      const message: LiveMessage = {
        messageId: createNonSecureContextUuid(),
        sessionId: session.id,
        text,
        state: 'queued',
        route: null,
        error: null,
        createdAt: now,
        updatedAt: now
      }
      liveSessionRegistryStore.upsertMessage(message)
      void sendIdempotently(message)
    },
    [session.id]
  )
  const onRetry = useCallback((messageId: string) => {
    void window.api.liveSessions
      .retry({ messageId })
      .then((m) => m && liveSessionRegistryStore.upsertMessage(m))
  }, [])
  const permission = session.permission
  const onAnswer = useCallback(
    (optionId: string) => {
      if (!permission) {
        return
      }
      setAnswering(optionId)
      void window.api.liveSessions
        .answer({ sessionId: session.id, promptId: permission.promptId, optionId })
        .finally(() => setAnswering(null))
    },
    [permission, session.id]
  )
  return (
    <LiveSessionChat
      session={session}
      transcript={transcript}
      pending={pending}
      onSend={onSend}
      onRetry={onRetry}
      onAnswer={onAnswer}
      answering={answering}
    />
  )
}

export default function LiveSessionsPage(): React.JSX.Element {
  const state = useLiveSessions()
  const now = useNow(30_000)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const currentId = selectedId ? liveSessionRegistryStore.currentId(selectedId) : null
  const selected =
    state.sessions.find((s) => s.id === currentId) ??
    (currentId ? null : (state.sessions[0] ?? null))
  return (
    <LiveSessionsView
      loaded={state.loaded}
      sessions={state.sessions}
      hostErrors={state.hostErrors}
      selectedId={selected?.id ?? null}
      onSelect={setSelectedId}
      onRefresh={() => void window.api.liveSessions?.refresh()}
      now={now}
      chat={
        selected ? (
          <SelectedSessionChat key={selected.id} session={selected} messages={state.messages} />
        ) : null
      }
    />
  )
}
