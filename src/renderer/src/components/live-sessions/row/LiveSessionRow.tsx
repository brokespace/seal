import React from 'react'
import { Bot, Ellipsis, Pin } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import { Checkbox } from '@/components/ui/checkbox'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { formatShortTimeAgo } from '@/lib/time-format/short-time-ago'
import { runningSubagents } from '../../../../../shared/live-sessions/live-session-activity'
import { liveSessionStatusGroup } from '../../../../../shared/live-sessions/live-session-status'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import {
  liveSessionDotState,
  liveSessionProviderLabel,
  liveSessionStatusText,
  liveSessionTitle
} from '../live-session-presentation'
import {
  CONTEXT_MENU_KIT,
  DROPDOWN_MENU_KIT,
  LiveSessionMenuItems,
  type LiveSessionMenuKit
} from '../menu/LiveSessionMenuItems'

export type ActiveAgentRowProps = {
  session: LiveSession
  /** The project or worktree it runs in, when Seal knows one. */
  workspaceName: string | null
  account: string | null
  unread: boolean
  /** Its chat is the one showing in the main area. */
  current: boolean
  /** A Projects badge, a fresh launch, or the active workspace points at it. */
  highlighted: boolean
  /** Null outside multi-select. */
  picked: boolean | null
  /** The one row Tab lands on; arrow keys move between the rest. */
  tabStop: boolean
  now: number
  onOpen: (session: LiveSession, event: React.MouseEvent | React.KeyboardEvent) => void
  onPick: (session: LiveSession, range: boolean) => void
  /** Fixtures and tests pass their own menu; the default runs the real handlers. */
  menu?: (session: LiveSession, kit: LiveSessionMenuKit) => React.ReactNode
}

function defaultMenu(session: LiveSession, kit: LiveSessionMenuKit): React.ReactNode {
  return <LiveSessionMenuItems session={session} kit={kit} />
}

function Preview({
  session,
  workspaceName
}: Pick<ActiveAgentRowProps, 'session' | 'workspaceName'>): React.JSX.Element {
  const t = useTranslate()
  const running = runningSubagents(session.activity)
  const current = session.permission?.question ?? session.statusDetail
  return (
    <div data-active-agent-preview={session.id} className="flex flex-col gap-2 text-xs">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold break-words">{liveSessionTitle(session)}</p>
        <p className="text-muted-foreground">
          {[liveSessionProviderLabel(session), session.machine.label, workspaceName]
            .filter(Boolean)
            .join(' \u00b7 ')}
        </p>
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="font-medium">{liveSessionStatusText(session)}</p>
        {current ? (
          <p className="line-clamp-2 font-mono text-2xs break-all text-muted-foreground">
            {current}
          </p>
        ) : null}
        {running.slice(0, 3).map((subagent) => (
          <p key={subagent.id} className="truncate text-muted-foreground">
            <Bot className="mr-1 inline size-3" />
            {subagent.title}
            {subagent.activity ? ` \u2014 ${subagent.activity}` : ''}
          </p>
        ))}
      </div>
      {session.lastMessage ? (
        <div className="flex flex-col gap-0.5">
          <p className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
            {t('auto.components.live-sessions.sidebar.lastMessage', 'Last message')}
          </p>
          <p className="line-clamp-4 break-words">{session.lastMessage}</p>
        </div>
      ) : null}
      {session.cwd ? (
        <p className="truncate font-mono text-2xs text-muted-foreground">{session.cwd}</p>
      ) : null}
    </div>
  )
}

/** One session in Active agents: who it is, where, what it is doing, with every action a click away. */
export const ActiveAgentRow = React.memo(function ActiveAgentRow(
  props: ActiveAgentRowProps
): React.JSX.Element {
  const t = useTranslate()
  const { session, picked, now } = props
  const menu = props.menu ?? defaultMenu
  const [preview, setPreview] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const group = liveSessionStatusGroup(session.status)
  const subagents = session.activity?.subagents.length ?? 0
  const runningCount = runningSubagents(session.activity).length
  // A busy session shows how long it has run; a quiet one, how long it has been quiet.
  const since =
    group === 'working' ? (session.startedAt ?? session.lastActivityAt) : session.lastActivityAt
  const secondary = [liveSessionStatusText(session), props.workspaceName ?? session.project]
    .filter(Boolean)
    .join(' \u00b7 ')

  return (
    <ContextMenu onOpenChange={setMenuOpen}>
      {/* A preview over an open menu would take the menu's Escape. */}
      <HoverCard
        openDelay={500}
        closeDelay={80}
        open={preview && !menuOpen}
        onOpenChange={setPreview}
      >
        <ContextMenuTrigger asChild>
          <HoverCardTrigger asChild>
            <div
              role="option"
              tabIndex={props.tabStop ? 0 : -1}
              aria-selected={picked ?? props.current}
              data-active-agent-row={session.id}
              data-status={session.status}
              data-status-group={group}
              data-current={props.current ? 'true' : undefined}
              data-highlighted={props.highlighted ? 'true' : undefined}
              onClick={(event) => {
                if (picked !== null || event.metaKey || event.ctrlKey || event.shiftKey) {
                  props.onPick(session, event.shiftKey)
                } else {
                  props.onOpen(session, event)
                }
              }}
              onDoubleClick={(event) => props.onOpen(session, event)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) {
                  return
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  props.onOpen(session, event)
                } else if (event.key === ' ') {
                  event.preventDefault()
                  props.onPick(session, event.shiftKey)
                }
              }}
              className={cn(
                'group/agent relative flex min-w-0 cursor-pointer items-start gap-1.5 rounded-md py-1 pr-1 pl-1.5 outline-none',
                'hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring focus-visible:ring-inset',
                props.current &&
                  'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground',
                props.highlighted && 'ring-1 ring-agent-working/60 ring-inset'
              )}
            >
              {picked !== null ? (
                <Checkbox
                  checked={picked}
                  tabIndex={-1}
                  aria-label={t('auto.components.live-sessions.sidebar.pick', 'Select session')}
                  className="mt-0.5 shrink-0"
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onPick(session, event.shiftKey)
                  }}
                />
              ) : null}
              <span className="relative mt-0.5 flex shrink-0">
                <AgentIcon agent={session.provider} size={14} />
                {props.unread ? (
                  <span
                    data-active-agent-unread
                    aria-label={t('auto.components.live-sessions.sidebar.unread', 'New output')}
                    className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-chat-unread ring-1 ring-worktree-sidebar"
                  />
                ) : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-center gap-1">
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-xs leading-4',
                      props.unread ? 'font-semibold' : 'font-medium'
                    )}
                  >
                    {liveSessionTitle(session)}
                  </span>
                  {session.pinned ? (
                    <Pin
                      className="size-3 shrink-0 text-muted-foreground"
                      aria-label={t('auto.components.live-sessions.sidebar.pinned', 'Pinned')}
                    />
                  ) : null}
                  <span
                    className="shrink-0 text-2xs text-muted-foreground tabular-nums"
                    title={
                      group === 'working'
                        ? t('auto.components.live-sessions.sidebar.runningFor', 'Running for')
                        : t('auto.components.live-sessions.sidebar.quietFor', 'Last activity')
                    }
                  >
                    {formatShortTimeAgo(since, now)}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-1 text-2xs leading-4 text-muted-foreground">
                  <AgentStateDot state={liveSessionDotState(session.status)} title={null} />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      group === 'working' && 'text-agent-working',
                      group === 'attention' && 'text-agent-question-text'
                    )}
                  >
                    {secondary}
                  </span>
                  {subagents > 0 ? (
                    <span
                      data-active-agent-subagents={subagents}
                      className={cn(
                        'flex shrink-0 items-center gap-0.5 tabular-nums',
                        runningCount > 0 && 'text-agent-working'
                      )}
                      title={t(
                        'auto.components.live-sessions.sidebar.subagentCount',
                        '{{running}} of {{count}} subagents running',
                        { running: runningCount, count: subagents }
                      )}
                    >
                      <Bot className="size-3" />
                      {subagents}
                    </span>
                  ) : null}
                  {props.account ? (
                    <span
                      data-active-agent-account
                      className="max-w-16 shrink-0 truncate rounded-sm border border-worktree-sidebar-border px-1 leading-[14px]"
                      title={t('auto.components.live-sessions.sidebar.account', 'Account')}
                    >
                      {props.account}
                    </span>
                  ) : null}
                </span>
              </span>
              <DropdownMenu onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    tabIndex={-1}
                    data-active-agent-actions
                    aria-label={t(
                      'auto.components.live-sessions.workspace.actions',
                      'Session actions'
                    )}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    className="absolute top-1 right-1 hidden size-5 items-center justify-center rounded-sm bg-worktree-sidebar-accent text-muted-foreground group-hover/agent:flex hover:text-foreground focus-visible:flex focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring focus-visible:outline-none data-[state=open]:flex"
                  >
                    <Ellipsis className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" onClick={(event) => event.stopPropagation()}>
                  {menu(session, DROPDOWN_MENU_KIT)}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </HoverCardTrigger>
        </ContextMenuTrigger>
        <HoverCardContent side="right" align="start" className="w-72">
          <Preview session={session} workspaceName={props.workspaceName} />
        </HoverCardContent>
      </HoverCard>
      <ContextMenuContent>{menu(session, CONTEXT_MENU_KIT)}</ContextMenuContent>
    </ContextMenu>
  )
})
