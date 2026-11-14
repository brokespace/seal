import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { ArrowLeft, Bot, Brain, Ellipsis, ListTodo, NotebookText, X } from 'lucide-react'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { openAppHttpLink } from '@/lib/browser/navigation/app-http-link-open'
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
import { recapOpenCount } from '../../../../../shared/session-recap/session-recap-view'
import { SessionRecapBar } from '../../session-recap/SessionRecapBar'
import { SessionRecapPanel } from '../../session-recap/SessionRecapPanel'
import { useSessionRecap, type SessionRecapModel } from '../../session-recap/use-session-recap'
import { LiveSessionActivityPanel } from './LiveSessionActivityPanel'
import { PanelButton } from './LiveSessionPanelButton'
import type { LiveSessionPanel, LiveSessionTabsState } from './live-session-tabs-store'

type Transcript = ReturnType<typeof useLiveTranscript>

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
  /** The session's recap and what its links do; a view without one shows no recap. */
  recap?: SessionRecapModel & {
    onOpenLink: (url: string) => void
    onOpenSettings?: () => void
  }
  /** The header's "…" menu; fixtures leave it out. */
  menu?: React.ReactNode
  /** Closes the split this pane sits in. */
  onCloseSplit?: () => void
}

/** One session's view without its data sources, so fixtures can render it. */
export function LiveSessionPaneView(props: LiveSessionPaneViewProps): React.JSX.Element {
  const t = useTranslate()
  const { session, transcript, panel, openSubagentId, recap } = props
  const [reveal, setReveal] = useState<{ messageId: string; nonce: number } | null>(null)
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
  const onOpenSubagent = (id: string | null): void => {
    setReveal(null)
    props.onOpenSubagent(id)
  }
  // A recap item's message lives in the session's own chat, behind any open subagent transcript.
  const onJump = (messageId: string): void => {
    props.onOpenSubagent(null)
    setReveal((last) => ({ messageId, nonce: (last?.nonce ?? 0) + 1 }))
  }
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
        {recap ? (
          <PanelButton
            panel="recap"
            active={panel === 'recap'}
            count={recapOpenCount(session.recap)}
            running={false}
            attention
            label={t('seal.sessionRecap.title', 'Recap')}
            onToggle={toggle}
          >
            <NotebookText className="size-3.5" />
          </PanelButton>
        ) : null}
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
      {recap ? (
        <SessionRecapBar
          view={recap.view}
          open={panel === 'recap'}
          now={props.now}
          onToggle={() => toggle('recap')}
        />
      ) : null}
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
                  onClick={() => onOpenSubagent(null)}
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
              reveal={reveal}
            />
          )}
        </div>
        {panel === 'recap' && recap ? (
          <SessionRecapPanel
            view={recap.view}
            refreshing={recap.refreshing}
            now={props.now}
            onRefresh={recap.refresh}
            onMark={recap.mark}
            onJump={onJump}
            onOpenLink={recap.onOpenLink}
            onOpenSettings={recap.onOpenSettings}
            onClose={() => props.onPanel(null)}
          />
        ) : panel && panel !== 'recap' ? (
          <LiveSessionActivityPanel
            panel={panel}
            provider={session.provider}
            activity={activity}
            reasoning={reasoning}
            openSubagentId={openSubagentId}
            onOpenSubagent={(id) => onOpenSubagent(id === openSubagentId ? null : id)}
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
  const recap = useSessionRecap(session.id, session.recap)
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
  const recapProps = useMemo(
    () => ({
      ...recap,
      onOpenLink: (url: string) => void openAppHttpLink(url),
      onOpenSettings: () => {
        const store = useAppStore.getState()
        store.openSettingsPage()
        store.openSettingsTarget({
          pane: 'accounts',
          repoId: null,
          sectionId: 'accounts-cloudflare-ai'
        })
      }
    }),
    [recap]
  )

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
      recap={recapProps}
      menu={<SessionMenuButton session={session} />}
      onCloseSplit={onCloseSplit}
    />
  )
}
