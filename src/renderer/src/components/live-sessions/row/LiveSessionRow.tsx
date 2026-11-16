import React from 'react'
import { Bot, Ellipsis, Pin } from 'lucide-react'
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
import { liveSessionSummaryView } from '../../../../../shared/session-summaries/live-session-summary-view'
import { SessionRecapBadge } from '@/components/session-recap/SessionRecapBadge'
import { SessionSummaryLine } from '@/components/session-summaries/SessionSummaryLine'
import { liveSessionTitle } from '../live-session-presentation'
import {
  CONTEXT_MENU_KIT,
  DROPDOWN_MENU_KIT,
  LiveSessionMenuItems,
  type LiveSessionMenuKit
} from '../menu/LiveSessionMenuItems'
import { LiveSessionStatusDot } from '../status/LiveSessionStatusDot'
import { LiveSessionStatusPill } from '../status/LiveSessionStatusPill'
import { LiveSessionPreview } from './LiveSessionPreview'

export type LiveSessionRowProps = {
  session: LiveSession
  /** The project or worktree it runs in, when Seal knows one. */
  workspaceName: string | null
  /** Off under the workspace itself, where the place would repeat the card above the row. */
  showPlace?: boolean
  /** The machine it runs on, where the list around the row does not already say. */
  machine?: string | null
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
  /** The sidebar's colors, or those of a page or panel. */
  tone?: keyof typeof TONES
  /** `card` leads with a large status dot and the status in words, for a list scanned by status. */
  layout?: 'row' | 'card'
  /** Fixtures and tests pass their own menu; the default runs the real handlers. */
  menu?: (session: LiveSession, kit: LiveSessionMenuKit) => React.ReactNode
}

function defaultMenu(session: LiveSession, kit: LiveSessionMenuKit): React.ReactNode {
  return <LiveSessionMenuItems session={session} kit={kit} />
}

const TONES = {
  sidebar: {
    row: 'hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground focus-visible:ring-worktree-sidebar-ring',
    current: 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground',
    actions: 'bg-worktree-sidebar-accent focus-visible:ring-worktree-sidebar-ring',
    unread: 'ring-worktree-sidebar',
    account: 'border-worktree-sidebar-border'
  },
  surface: {
    row: 'hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring',
    current: 'bg-accent text-accent-foreground',
    actions: 'bg-accent focus-visible:ring-ring',
    unread: 'ring-background',
    account: 'border-border'
  }
} as const

/**
 * One live session wherever sessions are listed: who it is, where, what it is doing, with the full
 * session menu on right-click and a preview on hover.
 */
export const LiveSessionRow = React.memo(function LiveSessionRow(
  props: LiveSessionRowProps
): React.JSX.Element {
  const t = useTranslate()
  const { session, picked, now } = props
  const menu = props.menu ?? defaultMenu
  const tone = TONES[props.tone ?? 'sidebar']
  const [preview, setPreview] = React.useState(false)
  const row = React.useRef<HTMLDivElement>(null)
  const openMenus = React.useRef(0)
  // Why held past the menu's close: the closing menu hands focus back to the row, and a hover timer
  // started before it opened still fires; either would open the preview with the pointer elsewhere.
  const previewHeld = React.useRef(false)
  const onMenuOpenChange = (open: boolean): void => {
    openMenus.current = Math.max(0, openMenus.current + (open ? 1 : -1))
    previewHeld.current = true
    setPreview(false)
  }
  // The pointer coming to the row, or a key pressed on it, asks for the preview afresh.
  const releasePreview = (): void => {
    if (openMenus.current === 0) {
      previewHeld.current = false
    }
  }
  const dropdownDismissedOutside = React.useRef(false)
  const group = liveSessionStatusGroup(session.status)
  const subagents = session.activity?.subagents.length ?? 0
  const runningCount = runningSubagents(session.activity).length
  // A busy session shows how long it has run; a quiet one, how long it has been quiet.
  const since =
    group === 'working' ? (session.startedAt ?? session.lastActivityAt) : session.lastActivityAt
  const place = props.showPlace === false ? null : (props.workspaceName ?? session.project)
  const summary = liveSessionSummaryView(session)
  const card = props.layout === 'card'
  // What it runs, asks for or failed on. A wait already names what it waits on.
  const detail =
    card &&
    group !== 'idle' &&
    session.status !== 'waiting-subagent' &&
    session.status !== 'waiting-task'
      ? (session.statusDetail ?? session.permission?.question)
      : null
  const after = [detail, place]
    .filter(Boolean)
    .map((part) => `\u00b7 ${part}`)
    .join(' ')

  return (
    <ContextMenu onOpenChange={onMenuOpenChange}>
      {/* A preview over an open menu would take the menu's Escape. */}
      <HoverCard
        openDelay={500}
        closeDelay={80}
        open={preview}
        onOpenChange={(open) => setPreview(open && !previewHeld.current)}
      >
        <ContextMenuTrigger asChild>
          <HoverCardTrigger asChild>
            <div
              ref={row}
              role="option"
              tabIndex={props.tabStop ? 0 : -1}
              aria-selected={picked ?? props.current}
              data-live-session-row={session.id}
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
              onPointerEnter={releasePreview}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) {
                  return
                }
                releasePreview()
                if (event.key === 'Enter') {
                  event.preventDefault()
                  props.onOpen(session, event)
                } else if (event.key === ' ') {
                  event.preventDefault()
                  props.onPick(session, event.shiftKey)
                }
              }}
              className={cn(
                // select-none: dragging a row must not select its title.
                'group/agent relative flex min-w-0 cursor-pointer items-start rounded-md pr-1 outline-none select-none',
                card ? 'gap-2 py-1.5 pl-2' : 'gap-1.5 py-1 pl-1.5',
                'focus-visible:ring-2 focus-visible:ring-inset',
                tone.row,
                props.current && tone.current,
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
              {card ? <LiveSessionStatusDot status={session.status} size="lg" /> : null}
              <span className="relative mt-0.5 flex shrink-0">
                <AgentIcon agent={session.provider} size={14} />
                {props.unread ? (
                  <span
                    data-live-session-unread
                    aria-label={t('auto.components.live-sessions.sidebar.unread', 'New output')}
                    className={cn(
                      'absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-chat-unread ring-1',
                      tone.unread
                    )}
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
                  <LiveSessionStatusPill
                    session={session}
                    dot={!card}
                    // With nothing after it the label takes the line, so a narrow sidebar still reads it whole.
                    className={cn(after ? 'max-w-[70%] shrink-0' : 'shrink', card && 'font-medium')}
                  />
                  <span className="min-w-0 flex-1 truncate">{after}</span>
                  {/* The card's status says whether it waits on the user; counts beside it only repeat that. */}
                  {card ? null : <SessionRecapBadge brief={session.recap} />}
                  {subagents > 0 ? (
                    <span
                      data-live-session-subagents={subagents}
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
                  {props.machine ? (
                    <span
                      data-live-session-machine
                      className={cn(
                        'max-w-20 shrink-0 truncate rounded-sm border px-1 leading-[14px]',
                        tone.account
                      )}
                      title={t('auto.components.live-sessions.sessionRows.machine', 'Machine')}
                    >
                      {props.machine}
                    </span>
                  ) : null}
                  {props.account ? (
                    <span
                      data-live-session-account
                      className={cn(
                        'max-w-16 shrink-0 truncate rounded-sm border px-1 leading-[14px]',
                        tone.account
                      )}
                      title={t('auto.components.live-sessions.sidebar.account', 'Account')}
                    >
                      {props.account}
                    </span>
                  ) : null}
                </span>
                {/* The hover preview shows the whole sentence. */}
                {summary ? (
                  <SessionSummaryLine summary={summary} tooltip={false} className="text-2xs" />
                ) : null}
              </span>
              <DropdownMenu onOpenChange={onMenuOpenChange}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    tabIndex={-1}
                    data-live-session-actions
                    aria-label={t(
                      'auto.components.live-sessions.workspace.actions',
                      'Session actions'
                    )}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    className={cn(
                      'absolute top-1 right-1 hidden size-5 items-center justify-center rounded-sm text-muted-foreground group-hover/agent:flex hover:text-foreground focus-visible:flex focus-visible:ring-2 focus-visible:outline-none data-[state=open]:flex',
                      tone.actions
                    )}
                  >
                    <Ellipsis className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  onClick={(event) => event.stopPropagation()}
                  onInteractOutside={() => {
                    dropdownDismissedOutside.current = true
                  }}
                  onCloseAutoFocus={(event) => {
                    // Why the row: its button is hidden once the pointer has left, so focus would fall out of the list.
                    if (!dropdownDismissedOutside.current) {
                      event.preventDefault()
                      row.current?.focus({ preventScroll: true })
                    }
                    dropdownDismissedOutside.current = false
                  }}
                >
                  {menu(session, DROPDOWN_MENU_KIT)}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </HoverCardTrigger>
        </ContextMenuTrigger>
        <HoverCardContent side="right" align="start" className="w-72">
          <LiveSessionPreview session={session} workspaceName={props.workspaceName} />
        </HoverCardContent>
      </HoverCard>
      <ContextMenuContent>{menu(session, CONTEXT_MENU_KIT)}</ContextMenuContent>
    </ContextMenu>
  )
})
