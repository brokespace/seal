import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bot, Brain, Ellipsis, ListTodo, X } from 'lucide-react'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import {
  runningBackgroundTasks,
  runningSubagents,
  subagentTranscriptId
} from '../../../../../shared/live-sessions/live-session-activity'
import type {
  LiveMessage,
  LiveSession
} from '../../../../../shared/live-sessions/live-session-types'
import { NativeChatMessageList } from '../../native-chat/NativeChatMessageList'
import type { NativeChatLiveSession } from '../../native-chat/session/terminal/read/native-chat-live-session-contract'
import { LiveSessionChat } from '../LiveSessionChat'
import { pendingRows } from '../live-session-pending-rows'
import { liveSessionProviderLabel, liveSessionTitle } from '../live-session-presentation'
import { liveSessionRegistryStore } from '../live-session-registry-store'
import { sendLiveMessage } from '../live-session-send'
import { DROPDOWN_MENU_KIT, LiveSessionMenuItems } from '../menu/LiveSessionMenuItems'
import { liveSessionMarksStore } from '../live-session-marks-store'
import { LiveSessionStatusPill } from '../status/LiveSessionStatusPill'
import { useLiveTranscript, type LiveTranscriptState } from '../use-live-transcript'
import { LiveSessionActivityPanel } from './LiveSessionActivityPanel'
import type { LiveSessionPanel, LiveSessionTabsState } from './live-session-tabs-store'

type Transcript = ReturnType<typeof useLiveTranscript>

function PanelButton({
  panel,
  active,
  count,
  running,
  label,
  onToggle,
  children
}: {
  panel: LiveSessionPanel
  active: boolean
  count: number | null
  /** Something in it is still going: the count is drawn in the working color. */
  running: boolean
  label: string
  onToggle: (panel: LiveSessionPanel) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      size="xs"
      aria-pressed={active}
      aria-label={label}
      title={label}
      data-live-session-panel-toggle={panel}
      onClick={() => onToggle(panel)}
    >
      {children}
      {/* A split pane has no room for the words. */}
      <span className="hidden @2xl:inline">{label}</span>
      {count ? (
        <span className={cn('tabular-nums', running ? 'text-agent-working' : 'opacity-70')}>
          {count}
        </span>
      ) : null}
    </Button>
  )
}

/** A subagent's own transcript, read-only, in place of its session's chat. */
function SubagentTranscript({
  session,
  transcript
}: {
  session: LiveSession
  transcript: LiveTranscriptState & Pick<Transcript, 'loadEarlier'>
}): React.JSX.Element {
  const chat = useMemo<NativeChatLiveSession>(() => {
    const phase = transcript.phase
    const ready = transcript.messages.length ? 'ready' : 'empty'
    return {
      messages: transcript.messages,
      agent: session.provider,
      sessionId: session.providerSessionId,
      status: phase === 'ready' ? ready : phase,
      error: transcript.error ?? undefined,
      readPhase: phase,
      hasMore: transcript.hasMore,
      loadingEarlier: transcript.loadingEarlier,
      olderHistoryGeneration: 0,
      loadEarlier: transcript.loadEarlier
    }
  }, [session.provider, session.providerSessionId, transcript])
  return <NativeChatMessageList session={chat} isWorking={false} expandSignal={false} />
}

export type LiveSessionPaneViewProps = {
  session: LiveSession
  transcript: LiveTranscriptState & Pick<Transcript, 'loadEarlier'>
  /** The open subagent's transcript; null while the session's own chat shows. */
  subagentTranscript: (LiveTranscriptState & Pick<Transcript, 'loadEarlier'>) | null
  messages: readonly LiveMessage[]
  panel: LiveSessionPanel | null
  onPanel: (panel: LiveSessionPanel | null) => void
  openSubagentId: string | null
  onOpenSubagent: (subagentId: string | null) => void
  onSend: (text: string) => void
  onRetry: (messageId: string) => void
  onAnswer: (optionId: string) => void
  answering: string | null
  composerFocus?: number
  now: number
  /** The header's "…" menu; fixtures leave it out. */
  menu?: React.ReactNode
  /** Closes the split this pane sits in. */
  onCloseSplit?: () => void
}

/** One session's view without its data sources, so fixtures can render it. */
export function LiveSessionPaneView(props: LiveSessionPaneViewProps): React.JSX.Element {
  const t = useTranslate()
  const { session, transcript, panel, openSubagentId } = props
  const activity = session.activity
  const subagents = activity?.subagents ?? []
  const openSubagent = subagents.find((subagent) => subagent.id === openSubagentId) ?? null
  const pending = useMemo(
    () => pendingRows(transcript.messages, props.messages),
    [transcript.messages, props.messages]
  )
  const reasoning = useMemo(
    () => transcript.messages.filter((message) => message.role === 'reasoning'),
    [transcript.messages]
  )
  const toggle = (next: LiveSessionPanel) => props.onPanel(panel === next ? null : next)
  return (
    <section
      data-live-session-pane={session.id}
      className="@container flex min-h-0 min-w-0 flex-1 flex-col bg-chat-pane"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <AgentIcon agent={session.provider} size={16} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-sm font-semibold">{liveSessionTitle(session)}</h2>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <LiveSessionStatusPill session={session} className="max-w-[60%] shrink-0" />
            <span className="min-w-0 truncate">
              {['', liveSessionProviderLabel(session), session.machine.label].join(' \u00b7 ')}
            </span>
            {session.cwd ? (
              <span className="hidden min-w-0 truncate font-mono @2xl:inline">{session.cwd}</span>
            ) : null}
          </p>
        </div>
        <PanelButton
          panel="subagents"
          active={panel === 'subagents'}
          count={subagents.length}
          running={runningSubagents(activity).length > 0}
          label={t('auto.components.live-sessions.activity.subagents', 'Subagents')}
          onToggle={toggle}
        >
          <Bot className="size-3.5" />
        </PanelButton>
        <PanelButton
          panel="tasks"
          active={panel === 'tasks'}
          count={(activity?.tasks.length ?? 0) + (activity?.todos.length ?? 0)}
          running={runningBackgroundTasks(activity).length > 0}
          label={t('auto.components.live-sessions.activity.tasks', 'Tasks')}
          onToggle={toggle}
        >
          <ListTodo className="size-3.5" />
        </PanelButton>
        <PanelButton
          panel="reasoning"
          active={panel === 'reasoning'}
          count={reasoning.length}
          running={false}
          label={t('auto.components.live-sessions.activity.reasoning', 'Reasoning')}
          onToggle={toggle}
        >
          <Brain className="size-3.5" />
        </PanelButton>
        {props.menu}
        {props.onCloseSplit ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={props.onCloseSplit}
            aria-label={t('auto.components.live-sessions.workspace.closeSplit', 'Close split')}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {openSubagent && props.subagentTranscript ? (
            <>
              <div
                data-live-subagent-transcript={openSubagent.id}
                className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => props.onOpenSubagent(null)}
                >
                  <ArrowLeft className="size-3.5" />
                  {t('auto.components.live-sessions.workspace.backToSession', 'Back to session')}
                </Button>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {t('auto.components.live-sessions.workspace.subagentOf', 'Subagent: {{title}}', {
                    title: openSubagent.title
                  })}
                </span>
              </div>
              <SubagentTranscript session={session} transcript={props.subagentTranscript} />
            </>
          ) : (
            <LiveSessionChat
              session={session}
              transcript={transcript}
              pending={pending}
              onSend={props.onSend}
              onRetry={props.onRetry}
              onAnswer={props.onAnswer}
              answering={props.answering}
              composerFocus={props.composerFocus}
            />
          )}
        </div>
        {panel ? (
          <LiveSessionActivityPanel
            panel={panel}
            provider={session.provider}
            activity={activity}
            reasoning={reasoning}
            openSubagentId={openSubagentId}
            onOpenSubagent={(id) => props.onOpenSubagent(id === openSubagentId ? null : id)}
            onClose={() => props.onPanel(null)}
            now={props.now}
          />
        ) : null}
      </div>
    </section>
  )
}

function SessionMenuButton({ session }: { session: LiveSession }): React.JSX.Element {
  const t = useTranslate()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t('auto.components.live-sessions.workspace.actions', 'Session actions')}
        >
          <Ellipsis className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <LiveSessionMenuItems session={session} kit={DROPDOWN_MENU_KIT} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** One open session: its transcript, subagents, tasks, reasoning, send box and permission card. */
export function LiveSessionPane({
  session,
  messages,
  focus,
  now,
  onCloseSplit
}: {
  session: LiveSession
  messages: ReadonlyMap<string, LiveMessage>
  focus: LiveSessionTabsState['focus']
  now: number
  onCloseSplit?: () => void
}): React.JSX.Element {
  const transcript = useLiveTranscript(session.id)
  const [panel, setPanel] = useState<LiveSessionPanel | null>(null)
  const [openSubagentId, setOpenSubagentId] = useState<string | null>(null)
  const [handledFocus, setHandledFocus] = useState(0)
  const [answering, setAnswering] = useState<string | null>(null)
  const subagentTranscript = useLiveTranscript(
    openSubagentId ? subagentTranscriptId(session.id, openSubagentId) : null
  )
  const mine = useMemo(
    () => [...messages.values()].filter((message) => message.sessionId === session.id),
    [messages, session.id]
  )

  // A menu elsewhere asked this view to show something.
  const focusNonce = focus?.sessionId === session.id ? focus.nonce : 0
  const focusTarget = focus?.sessionId === session.id ? focus.target : null
  if (focusNonce !== handledFocus) {
    setHandledFocus(focusNonce)
    if (focusTarget === 'permission') {
      setOpenSubagentId(null)
    } else if (focusTarget && focusTarget !== 'composer') {
      setPanel(focusTarget)
    }
  }
  const composerFocus = focusTarget === 'composer' ? focusNonce : 0

  // What is on screen has been seen.
  useEffect(() => {
    liveSessionMarksStore.markSeen(session.id, session.lastActivityAt)
  }, [session.id, session.lastActivityAt])

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
  const onRetry = useCallback((messageId: string) => {
    void window.api.liveSessions
      .retry({ messageId })
      .then((message) => message && liveSessionRegistryStore.upsertMessage(message))
  }, [])
  const onSend = useCallback((text: string) => sendLiveMessage(session.id, text), [session.id])

  return (
    <LiveSessionPaneView
      session={session}
      transcript={transcript}
      subagentTranscript={openSubagentId ? subagentTranscript : null}
      messages={mine}
      panel={panel}
      onPanel={setPanel}
      openSubagentId={openSubagentId}
      onOpenSubagent={setOpenSubagentId}
      onSend={onSend}
      onRetry={onRetry}
      onAnswer={onAnswer}
      answering={answering}
      composerFocus={composerFocus}
      now={now}
      menu={<SessionMenuButton session={session} />}
      onCloseSplit={onCloseSplit}
    />
  )
}
