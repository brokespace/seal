import { useMemo, useRef, useState } from 'react'
import { useDndMonitor } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CircleDashed, Folder, GitBranch } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import {
  liveSessionDotState,
  liveSessionStatusText
} from '@/components/live-sessions/live-session-presentation'
import {
  ACTIVE_TAB_INDICATOR_CLASSES,
  TAB_ROOT_CLASSES,
  getDropIndicatorClasses,
  getTabRootStateClasses,
  getTabStripBorderClasses,
  type DropIndicator
} from '@/components/tab-bar/drop-indicator'
import { EditorFileTabCloseButton } from '@/components/tab-bar/EditorFileTabCloseButton'
import {
  closeTabOnMiddleClick,
  preventMiddleButtonDefault
} from '@/components/tab-bar/middle-button-default-guard'
import {
  useTabContextMenuDismissal,
  useTabContextMenuOpening
} from '@/components/tab-bar/tab-context-menu-opening'
import { TabHoverCard } from '@/components/tab-bar/TabHoverCard'
import { useTabStripPointerActivation } from '@/components/tab-bar/tab-strip-pointer-activation'
import { TAB_LABEL_WIDTH_CLASSES } from '@/components/tab-bar/tab-width-rules'
import { useTabStripSlotProps } from '@/components/tab-bar/use-tab-strip-slot-props'
import { useTranslate } from '@/i18n/use-translate'
import { CLOSE_ALL_CONTEXT_MENUS_EVENT } from '@/lib/overlay-interaction/close-all-context-menus'
import type { ItemTabCommands } from './item-tab-commands'
import { ItemTabMenu } from './ItemTabMenu'
import {
  bringKeyboardFocusIntoFocusedPane,
  keepKeyboardOnStripControl,
  noteKeyboardHolderBeforeTabMenu,
  returnKeyboardLeftByTabMenus
} from './pane-keyboard-focus'
import { ITEM_TAB_KEY_ATTRIBUTE } from './split-view-drop-target'
import type { ResolvedSplitViewItem } from './split-view-item-resolution'
import { splitViewStore } from './split-view-store'
import { splitViewItemKey, type SplitViewItem, type SplitViewTab } from './split-view-types'
import { useResolvedSplitViewItem, useSplitViewItemTitle } from './use-resolved-split-view-item'

/** What a dragged item tab tells the drag layer. */
type ItemTabDragData = { kind: 'item-tab'; item: SplitViewItem }

export function isItemTabDragData(value: unknown): value is ItemTabDragData {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'item-tab'
}

export function ItemTabIcon({
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
        <AgentStateDot
          state={liveSessionDotState(resolved.session.status)}
          label={liveSessionStatusText(resolved.session)}
          title={null}
        />
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

/**
 * A workspace, session or project as a tab, made of the pieces every tab in a strip is made of:
 * the sortable slot, pointer activation, the drop indicator, the label and the close button.
 */
export function ItemTab({
  tab,
  active,
  tabCount,
  hasTabsToRight,
  dropIndicator,
  commands
}: {
  tab: SplitViewTab
  active: boolean
  tabCount: number
  hasTabsToRight: boolean
  dropIndicator: DropIndicator
  commands: ItemTabCommands
}): React.JSX.Element {
  const t = useTranslate()
  const { item, preview } = tab
  const key = splitViewItemKey(item)
  const resolved = useResolvedSplitViewItem(item)
  const title = useSplitViewItemTitle(item, resolved)
  const dragData = useMemo((): ItemTabDragData => ({ kind: 'item-tab', item }), [item])
  // Keep dragged tabs anchored; only the insertion bar moves.
  const { attributes, listeners, setNodeRef } = useSortable({
    id: key,
    data: dragData,
    // Roving focus: the arrow keys move between tabs, Tab leaves the strip.
    attributes: { role: 'tab', tabIndex: active ? 0 : -1 }
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const focusedPaneAtOpen = useRef<string | null>(null)
  const { onPointerDown, retirePendingActivation } = useTabStripPointerActivation({
    onActivate: () => commands.activate(item)
  })
  const handleMenuOpenChange = useTabContextMenuOpening(setMenuOpen, retirePendingActivation)
  // A drag given up with Esc is not a click, wherever the pointer is then released.
  useDndMonitor(
    useMemo(() => ({ onDragCancel: retirePendingActivation }), [retirePendingActivation])
  )
  useTabContextMenuDismissal(menuOpen, setMenuOpen)
  const slotProps = useTabStripSlotProps(key, active)
  const icon = <ItemTabIcon item={item} resolved={resolved} />

  const tabRoot = (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-selected={active}
      {...{ [ITEM_TAB_KEY_ATTRIBUTE]: key }}
      data-live-session-tab={item.kind === 'session' ? item.sessionId : undefined}
      data-item-tab-preview={preview ? '' : undefined}
      data-item-tab-drop-edge={dropIndicator ?? undefined}
      className={`${TAB_ROOT_CLASSES} focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${getTabStripBorderClasses(hasTabsToRight)} ${getDropIndicatorClasses(dropIndicator)} ${getTabRootStateClasses(active)}`}
      onPointerDown={(event) => {
        onPointerDown(
          event,
          listeners?.onPointerDown as ((event: React.PointerEvent<Element>) => void) | undefined
        )
      }}
      onDoubleClick={() => commands.keep(item)}
      onMouseDown={preventMiddleButtonDefault}
      onMouseUp={preventMiddleButtonDefault}
      onAuxClick={(event) => closeTabOnMiddleClick(event, () => commands.close(item))}
      onKeyDown={(event) => {
        // Enter and Space on the close button are its own, not the tab's.
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          keepKeyboardOnStripControl(event.currentTarget)
          commands.activate(item)
        }
      }}
    >
      {active && <span className={ACTIVE_TAB_INDICATOR_CLASSES} aria-hidden />}
      {resolved || item.kind !== 'session' ? (
        <span className="mr-1 flex shrink-0 items-center gap-1">{icon}</span>
      ) : null}
      <span className={`${TAB_LABEL_WIDTH_CLASSES} mr-1${preview ? ' italic' : ''}`}>{title}</span>
      <div className="flex size-4 shrink-0 items-center justify-center">
        <EditorFileTabCloseButton
          fileIsDirty={false}
          showsSelectionChrome={active}
          onClose={() => commands.close(item)}
        />
      </div>
    </div>
  )
  const slot = (
    <div
      {...slotProps}
      onContextMenu={(event) => {
        // The hover card is portalled: React still routes its events through this slot.
        if (event.target instanceof Node && event.currentTarget.contains(event.target)) {
          window.dispatchEvent(new Event(CLOSE_ALL_CONTEXT_MENUS_EVENT))
        }
      }}
    >
      <TabHoverCard
        disabled={menuOpen}
        title={title}
        programName={
          resolved?.kind === 'session'
            ? liveSessionStatusText(resolved.session)
            : item.kind === 'project'
              ? t('seal.splitView.item.project', 'Project')
              : item.kind === 'workspace'
                ? t('seal.splitView.item.workspace', 'Workspace')
                : title
        }
        icon={icon}
        // A session's tab shows its state as a dot only.
        showWhenUnclipped={resolved?.kind === 'session'}
      >
        {tabRoot}
      </TabHoverCard>
    </div>
  )
  // A session that left the registry has nothing its menu could act on.
  if (item.kind === 'session' && resolved?.kind !== 'session' && !commands.closeOthers) {
    return slot
  }
  return (
    <ContextMenu
      open={menuOpen}
      onOpenChange={(open) => {
        if (open) {
          focusedPaneAtOpen.current = splitViewStore.getState().focusedPaneId
          noteKeyboardHolderBeforeTabMenu()
        }
        handleMenuOpenChange(open)
      }}
    >
      <ContextMenuTrigger asChild>{slot}</ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(event) => {
          // An entry that moved pane focus takes the keyboard along; otherwise it returns where it was.
          const focusedPaneId = splitViewStore.getState().focusedPaneId
          if (focusedPaneId !== null && focusedPaneId !== focusedPaneAtOpen.current) {
            event.preventDefault()
            bringKeyboardFocusIntoFocusedPane()
          }
          returnKeyboardLeftByTabMenus()
        }}
      >
        <ItemTabMenu item={item} resolved={resolved} tabCount={tabCount} commands={commands} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
