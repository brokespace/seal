import { SortableContext } from '@dnd-kit/sortable'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TabStripScrollIndicator } from './TabStripScrollIndicator'
import { TabStripTooltipProvider } from './TabStripTooltipProvider'
import { getTabStripScrollMaskClassName } from './tab-strip-scroll-metrics'
import type { useTabStripOverflowNavigation } from './tab-strip-overflow-navigation'
import type { useTabStripDragScrollHandlers } from './tab-strip-drag-scroll'

function ScrollButton({
  direction,
  navigation,
  dragScroll
}: {
  direction: 'start' | 'end'
  navigation: ReturnType<typeof useTabStripOverflowNavigation>
  dragScroll: ReturnType<typeof useTabStripDragScrollHandlers>
}): React.JSX.Element {
  const t = useTranslate()
  const { tabStripOverflowState, scrollTabStrip } = navigation
  const canScroll =
    direction === 'start'
      ? tabStripOverflowState.canScrollStart
      : tabStripOverflowState.canScrollEnd
  const label =
    direction === 'start'
      ? t('auto.components.tab.bar.TabBar.7a9b4af2af', 'Scroll tabs left')
      : t('auto.components.tab.bar.TabBar.232e075b07', 'Scroll tabs right')
  const Chevron = direction === 'start' ? ChevronLeft : ChevronRight
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="mx-0.5 my-auto h-6 w-5 @max-[260px]/tab-strip:hidden"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          aria-label={label}
          aria-disabled={!canScroll}
          disabled={!dragScroll.isTabDragActive && !canScroll}
          onClick={() => scrollTabStrip(direction)}
          onPointerEnter={
            direction === 'start'
              ? dragScroll.onDragScrollStartEnter
              : dragScroll.onDragScrollEndEnter
          }
          onPointerLeave={dragScroll.onDragScrollLeave}
        >
          <Chevron className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * A row of tabs that scrolls when they outgrow it: the scroll buttons, the sortable strip with
 * its edge masks, and the scroll indicator. Every tab strip in the app is this one.
 */
export function TabStripViewport({
  sortableIds,
  navigation,
  dragScroll,
  singleTab,
  hasTabs,
  strip,
  children
}: {
  sortableIds: string[]
  navigation: ReturnType<typeof useTabStripOverflowNavigation>
  dragScroll: ReturnType<typeof useTabStripDragScrollHandlers>
  singleTab: boolean
  hasTabs: boolean
  /** What the strip is to assistive technology and to the keyboard. */
  strip?: Pick<React.HTMLAttributes<HTMLDivElement>, 'role' | 'aria-label' | 'onKeyDown'>
  children: React.ReactNode
}): React.JSX.Element {
  const { tabStripRef, tabStripOverflowState, activeTabDockSide, subscribeToStripResize } =
    navigation
  return (
    <>
      {tabStripOverflowState.hasOverflow ? (
        <ScrollButton direction="start" navigation={navigation} dragScroll={dragScroll} />
      ) : null}
      {/* Keep drag siblings anchored; only the insertion bar moves. */}
      <SortableContext items={sortableIds}>
        {/* Why: no-drag lets tab interactions work inside the titlebar's drag region (outer container stays window-draggable). */}
        <div
          data-single-tab={singleTab ? '' : undefined}
          // Why: tabs are the only drag source, so a narrow pane clips the "+" before the last tab sliver.
          className={`group/tab-strip relative flex min-h-0 w-max max-w-full shrink ${
            hasTabs ? 'min-w-10' : 'min-w-0'
          }`}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div
            {...strip}
            ref={tabStripRef}
            data-active-tab-docked={activeTabDockSide ?? undefined}
            // Why: only `border-r` here — a strip-level `border-l` would render a heavier L-corner than the first tab's own `border-l`.
            className={[
              'terminal-tab-strip flex h-full min-w-0 max-w-full flex-1 items-stretch overflow-x-auto overflow-y-hidden',
              'border-r border-border/70',
              getTabStripScrollMaskClassName(tabStripOverflowState, activeTabDockSide)
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <TabStripTooltipProvider>{children}</TabStripTooltipProvider>
          </div>
          <TabStripScrollIndicator
            hasOverflow={tabStripOverflowState.hasOverflow}
            scrollContainerRef={tabStripRef}
            subscribeToStripResize={subscribeToStripResize}
            disabled={dragScroll.isTabDragActive}
          />
        </div>
      </SortableContext>
      {tabStripOverflowState.hasOverflow ? (
        <ScrollButton direction="end" navigation={navigation} dragScroll={dragScroll} />
      ) : null}
    </>
  )
}
