import { useEffect, useRef } from 'react'
import { CircleDashed, Folder, GitBranch, X } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import {
  liveSessionDotState,
  liveSessionStatusText
} from '@/components/live-sessions/live-session-presentation'
import { revealTabStripSlot } from '@/components/tab-bar/tab-strip-slot-geometry'
import { bindTabStripContentResizeObservers } from '@/components/tab-bar/tab-strip-content-resize-observers'
import { scrollTabStripOnWheel } from '@/components/tab-bar/tab-strip-wheel-scroll'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { ItemTabMenu } from './ItemTabMenu'
import { startItemPointerDrag } from './item-pointer-drag'
import type { ResolvedSplitViewItem } from './split-view-item-resolution'
import { KEEPS_FOCUS_ATTRIBUTE } from '@/lib/overlay-interaction/focus-keeping-press'
import { ITEM_TAB_KEY_ATTRIBUTE, ITEM_TAB_STRIP_ATTRIBUTE } from './split-view-drop-target'
import {
  splitViewItemKey,
  type SplitViewEdge,
  type SplitViewItem,
  type SplitViewTab
} from './split-view-types'
import { useResolvedSplitViewItem, useSplitViewItemTitle } from './use-resolved-split-view-item'

export type ItemTabCommands = {
  activate: (item: SplitViewItem) => void
  /** A preview tab becomes a kept one. */
  keep: (item: SplitViewItem) => void
  close: (item: SplitViewItem) => void
  /** Absent on the agent-session page, whose tabs keep the session's own menu only. */
  closeOthers?: (item: SplitViewItem) => void
  closePane?: () => void
  moveToNewPane?: (item: SplitViewItem, edge: SplitViewEdge) => void
}

function ItemTabIcon({
  item,
  resolved
}: {
  item: SplitViewItem
  resolved: ResolvedSplitViewItem | null
}): React.JSX.Element | null {
  if (resolved?.kind === 'session') {
    return (
      <>
        <AgentIcon agent={resolved.session.provider} size={13} />
        <AgentStateDot state={liveSessionDotState(resolved.session.status)} title={null} />
      </>
    )
  }
  if (resolved?.kind === 'project') {
    return (
      <RepoIconGlyph
        repoIcon={resolved.repo.repoIcon}
        color={resolved.repo.badgeColor}
        className="size-3.5 shrink-0"
        iconClassName="size-3"
      />
    )
  }
  if (resolved?.kind === 'workspace') {
    const Glyph = resolved.isFolder ? Folder : GitBranch
    return <Glyph className="size-3.5 shrink-0" aria-hidden />
  }
  // An ended session's tab has no icon, as on the session page before.
  return item.kind === 'session' ? null : <CircleDashed className="size-3.5 shrink-0" aria-hidden />
}

function ItemTab({
  tab,
  active,
  tabCount,
  commands
}: {
  tab: SplitViewTab
  active: boolean
  tabCount: number
  commands: ItemTabCommands
}): React.JSX.Element {
  const t = useTranslate()
  const { item, preview } = tab
  const key = splitViewItemKey(item)
  const resolved = useResolvedSplitViewItem(item)
  const title = useSplitViewItemTitle(item, resolved)
  const element = (
    <div
      role="tab"
      // Roving focus: the arrow keys move between tabs, Tab leaves the strip.
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      {...{ [ITEM_TAB_KEY_ATTRIBUTE]: key }}
      data-live-session-tab={item.kind === 'session' ? item.sessionId : undefined}
      data-item-tab-preview={preview ? '' : undefined}
      title={
        resolved?.kind === 'session'
          ? `${title} \u2014 ${liveSessionStatusText(resolved.session)}`
          : title
      }
      onPointerDown={(event) => {
        // The close button's presses are its own.
        if (!(event.target instanceof Element) || !event.target.closest('button')) {
          startItemPointerDrag(event, event.currentTarget, item)
        }
      }}
      onClick={() => commands.activate(item)}
      onDoubleClick={() => commands.keep(item)}
      onAuxClick={(event) => {
        if (event.button === 1) {
          commands.close(item)
        }
      }}
      onKeyDown={(event) => {
        // Enter and Space on the close button are its own, not the tab's.
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          commands.activate(item)
        }
      }}
      className={cn(
        'group flex h-8 max-w-56 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-2.5 text-xs outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        active
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      )}
    >
      <ItemTabIcon item={item} resolved={resolved} />
      <span className={cn('min-w-0 truncate', preview && 'italic')}>{title}</span>
      <button
        type="button"
        aria-label={t('auto.components.live-sessions.workspace.closeTab', 'Close tab')}
        onClick={(event) => {
          event.stopPropagation()
          commands.close(item)
        }}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          !active && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
        )}
      >
        <X className="size-3" />
      </button>
    </div>
  )
  // A session that left the registry has nothing its menu could act on.
  if (item.kind === 'session' && resolved?.kind !== 'session' && !commands.closeOthers) {
    return element
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{element}</ContextMenuTrigger>
      <ContextMenuContent>
        <ItemTabMenu item={item} resolved={resolved} tabCount={tabCount} commands={commands} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

function moveTabFocus(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
    return
  }
  const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')]
  const from = event.target instanceof HTMLElement ? tabs.indexOf(event.target) : -1
  if (from === -1) {
    return
  }
  event.preventDefault()
  const step = event.key === 'ArrowRight' ? 1 : -1
  tabs[(from + step + tabs.length) % tabs.length].focus()
}

/**
 * The strip of item tabs: the agent-session page's tabs, and every split-view pane's. One strip
 * and one tab, so the two cannot drift apart.
 */
export function ItemTabStrip({
  paneId,
  tabs,
  activeKey,
  label,
  commands,
  before,
  after,
  keepsFocus = false,
  className,
  style
}: {
  /** Null for the agent-session page in single view. */
  paneId: string | null
  tabs: readonly SplitViewTab[]
  activeKey: string | null
  /** Names the tablist. */
  label: string
  commands: ItemTabCommands
  before?: React.ReactNode
  after?: React.ReactNode
  /** A press on the strip leaves a terminal its keyboard. */
  keepsFocus?: boolean
  className?: string
  style?: React.CSSProperties
}): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const hasTabs = tabs.length > 0
  // The tab a pane shows may sit past the edge of a strip that overflows, or that got narrower.
  useEffect(() => {
    const list = listRef.current
    if (!list) {
      return undefined
    }
    const reveal = (): void => {
      const selected = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      if (selected) {
        revealTabStripSlot(list, selected)
      }
    }
    reveal()
    return bindTabStripContentResizeObservers(list, reveal)
  }, [activeKey, tabs.length])
  // As in a workspace's tab strip: no scrollbar, and the wheel scrolls it sideways.
  useEffect(() => {
    const list = listRef.current
    return list ? scrollTabStripOnWheel(list) : undefined
  }, [hasTabs])
  return (
    <div
      {...{ [ITEM_TAB_STRIP_ATTRIBUTE]: paneId ?? '' }}
      {...(keepsFocus ? { [KEEPS_FOCUS_ATTRIBUTE]: '' } : {})}
      className={cn(
        '@container/session-tabs flex shrink-0 border-b border-border bg-muted/40',
        className
      )}
      style={style}
    >
      {before}
      {hasTabs ? (
        <div
          ref={listRef}
          role="tablist"
          aria-label={label}
          onKeyDown={moveTabFocus}
          className="scrollbar-none flex min-w-20 flex-1 overflow-x-auto overflow-y-hidden"
        >
          {tabs.map((tab) => {
            const key = splitViewItemKey(tab.item)
            return (
              <ItemTab
                key={key}
                tab={tab}
                active={key === activeKey}
                tabCount={tabs.length}
                commands={commands}
              />
            )
          })}
        </div>
      ) : (
        <div className="flex-1" />
      )}
      {after}
    </div>
  )
}
