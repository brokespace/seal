import { Bot, Ellipsis, ListTodo, NotebookText } from 'lucide-react'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useSessionMachineName } from '@/components/machines/model/use-local-machine-name'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import {
  runningBackgroundTasks,
  runningSubagents
} from '../../../../../shared/live-sessions/live-session-activity'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { recapOpenCount } from '../../../../../shared/session-recap/session-recap-view'
import { liveSessionProviderLabel, liveSessionTitle } from '../live-session-presentation'
import { DROPDOWN_MENU_KIT, LiveSessionMenuItems } from '../menu/LiveSessionMenuItems'
import { LiveSessionStatusPill } from '../status/LiveSessionStatusPill'
import type { AgentSessionPanel } from './agent-session-focus-requests'
import { AgentSessionPanelButton } from './AgentSessionPanelButton'

function AgentSessionMenuButton({ session }: { session: LiveSession }): React.JSX.Element {
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

/**
 * One row over a session's chat, whichever surface runs it: what it is, how it stands, where it
 * runs, the panels beside the chat and the session menu.
 */
export function AgentSessionHeader({
  session,
  panel,
  onToggle,
  className
}: {
  session: LiveSession
  /** The panel showing beside the chat. */
  panel: AgentSessionPanel | null
  onToggle: (panel: AgentSessionPanel) => void
  className?: string
}): React.JSX.Element {
  const t = useTranslate()
  const machineName = useSessionMachineName()
  const activity = session.activity
  const title = liveSessionTitle(session)
  return (
    <header
      data-agent-session-header=""
      className={cn(
        '@container flex min-w-0 items-center gap-2 border-b border-border bg-chat-pane px-3 py-1',
        className
      )}
    >
      <AgentIcon agent={session.provider} size={14} />
      <h2 title={title} className="min-w-0 truncate text-[13px] font-medium">
        {title}
      </h2>
      <LiveSessionStatusPill session={session} className="max-w-[40%] shrink-0 text-xs" />
      {/* A split pane has room for the title and the status only. */}
      <p
        title={session.cwd ?? undefined}
        className="hidden min-w-0 flex-auto truncate text-xs text-muted-foreground @lg:block"
      >
        {[liveSessionProviderLabel(session), machineName(session.machine)].join(' \u00b7 ')}
        {session.cwd ? (
          <span className="ml-2 hidden font-mono @2xl:inline">{session.cwd}</span>
        ) : null}
      </p>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {session.capabilities.recap ? (
          <AgentSessionPanelButton
            panel="recap"
            active={panel === 'recap'}
            count={recapOpenCount(session.recap)}
            running={false}
            attention
            label={t('seal.sessionRecap.title', 'Recap')}
            onToggle={onToggle}
          >
            <NotebookText className="size-3.5" />
          </AgentSessionPanelButton>
        ) : null}
        <AgentSessionPanelButton
          panel="subagents"
          active={panel === 'subagents'}
          count={activity?.subagents.length ?? 0}
          running={runningSubagents(activity).length > 0}
          label={t('auto.components.live-sessions.activity.subagents', 'Subagents')}
          onToggle={onToggle}
        >
          <Bot className="size-3.5" />
        </AgentSessionPanelButton>
        <AgentSessionPanelButton
          panel="tasks"
          active={panel === 'tasks'}
          count={(activity?.tasks.length ?? 0) + (activity?.todos.length ?? 0)}
          running={runningBackgroundTasks(activity).length > 0}
          label={t('auto.components.live-sessions.activity.tasks', 'Tasks')}
          onToggle={onToggle}
        >
          <ListTodo className="size-3.5" />
        </AgentSessionPanelButton>
        <AgentSessionMenuButton session={session} />
      </div>
    </header>
  )
}
