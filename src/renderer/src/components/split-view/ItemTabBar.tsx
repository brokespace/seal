import { useMemo } from 'react'
import {
  TAB_STRIP_CONTAINER_CLASSES,
  TAB_STRIP_ROW_CLASSES,
  type DropIndicator
} from '@/components/tab-bar/drop-indicator'
import { useTabStripDragScrollHandlers } from '@/components/tab-bar/tab-strip-drag-scroll'
import { useTabStripOverflowNavigation } from '@/components/tab-bar/tab-strip-overflow-navigation'
import { revealTabStripSlot } from '@/components/tab-bar/tab-strip-slot-geometry'
import { TabStripViewport } from '@/components/tab-bar/TabStripViewport'
import { resolveTabIndicatorEdges } from '@/components/tab-group/tab-insertion'
import { cn } from '@/lib/class-names'
import { KEEPS_FOCUS_ATTRIBUTE } from '@/lib/overlay-interaction/focus-keeping-press'
import type { ItemTabCommands } from './item-tab-commands'
import { ItemTab } from './ItemTab'
import { bridgeTabKeyFromItemStrip } from './pane-tab-key-order'
import { useSplitViewDropPreview } from './split-view-drag-state'
import { ITEM_TAB_ROW_ATTRIBUTE, ITEM_TAB_STRIP_ATTRIBUTE } from './split-view-drop-target'
import { splitViewItemKey, type SplitViewTab } from './split-view-types'
import { useSelectedTabKeptInNarrowingStrip } from './use-selected-tab-kept-in-narrowing-strip'

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
  const next = tabs[(from + step + tabs.length) % tabs.length]
  next.focus({ preventScroll: true })
  // The browser's own scroll leaves a tab under the docked one.
  const slot = next.closest<HTMLElement>('[data-tab-strip-slot]')
  if (slot) {
    revealTabStripSlot(event.currentTarget, slot)
  }
}

/**
 * The tabs of a split-view pane: workspaces and projects in the tab strip every workspace tab
 * group uses, so they lay out, overflow and drag the same.
 */
export function ItemTabBar({
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
  paneId: string
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
  const keys = useMemo(() => tabs.map((tab) => splitViewItemKey(tab.item)), [tabs])
  const navigation = useTabStripOverflowNavigation({
    activeVisibleTabId: activeKey,
    activeDockSlotId: activeKey,
    layoutKey: keys.join('|'),
    // Names the strip, so one that changes hands starts over.
    worktreeId: paneId
  })
  useSelectedTabKeptInNarrowingStrip(navigation, activeKey)
  const dragScroll = useTabStripDragScrollHandlers(navigation.scrollTabStrip, {
    start: navigation.tabStripOverflowState.canScrollStart,
    end: navigation.tabStripOverflowState.canScrollEnd
  })
  const insertion = useSplitViewDropPreview()?.insertion
  const dropIndicators = useMemo(() => {
    const edges = resolveTabIndicatorEdges(keys, insertion?.groupId === paneId ? insertion : null)
    return new Map<string, DropIndicator>(edges.map((edge) => [edge.visibleTabId, edge.side]))
  }, [paneId, insertion, keys])
  return (
    <div
      {...{ [ITEM_TAB_STRIP_ATTRIBUTE]: paneId }}
      {...(keepsFocus ? { [KEEPS_FOCUS_ATTRIBUTE]: '' } : {})}
      className={cn(TAB_STRIP_ROW_CLASSES, '@container/session-tabs flex items-stretch', className)}
      style={style}
      onKeyDown={bridgeTabKeyFromItemStrip}
    >
      {before}
      <div {...{ [ITEM_TAB_ROW_ATTRIBUTE]: '' }} className={TAB_STRIP_CONTAINER_CLASSES}>
        <div className="flex h-full min-w-10 flex-1 items-stretch overflow-hidden">
          <TabStripViewport
            sortableIds={keys}
            navigation={navigation}
            dragScroll={dragScroll}
            singleTab={tabs.length === 1}
            hasTabs={tabs.length > 0}
            strip={{ role: 'tablist', 'aria-label': label, onKeyDown: moveTabFocus }}
          >
            {tabs.map((tab, index) => {
              const key = keys[index]
              return (
                <ItemTab
                  key={key}
                  tab={tab}
                  active={key === activeKey}
                  tabCount={tabs.length}
                  hasTabsToRight={index < tabs.length - 1}
                  dropIndicator={dropIndicators.get(key) ?? null}
                  commands={commands}
                />
              )
            })}
          </TabStripViewport>
        </div>
      </div>
      {after}
    </div>
  )
}
