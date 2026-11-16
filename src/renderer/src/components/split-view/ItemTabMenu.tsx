import { X } from 'lucide-react'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import {
  CONTEXT_MENU_KIT,
  LiveSessionMenuItemsView,
  useLiveSessionMenuContext
} from '@/components/live-sessions/menu/LiveSessionMenuItems'
import { liveSessionMenuEffects } from '@/components/live-sessions/menu/live-session-menu-effects'
import { CloseSplitPaneMenuItem } from '@/components/tab-bar/CloseSplitPaneMenuItem'
import { useTranslate } from '@/i18n/use-translate'
import type { ItemTabCommands } from './ItemTabStrip'
import type { ResolvedSplitViewItem } from './split-view-item-resolution'
import { SplitViewPlacementMenu } from './SplitViewPlacementMenu'
import type { SplitViewItem } from './split-view-types'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'

/** A session's own entries; "Open in split" on a pane's tab splits that pane, not the focused one. */
function SessionTabMenuItems({
  session,
  splitOwnPane
}: {
  session: LiveSession
  splitOwnPane: (() => void) | null
}): React.JSX.Element {
  const context = useLiveSessionMenuContext(session)
  const effects = splitOwnPane
    ? {
        ...liveSessionMenuEffects,
        open: (sessionId: string, mode: Parameters<typeof liveSessionMenuEffects.open>[1]) =>
          mode === 'split' ? splitOwnPane() : liveSessionMenuEffects.open(sessionId, mode)
      }
    : liveSessionMenuEffects
  return (
    <LiveSessionMenuItemsView
      session={session}
      context={context}
      kit={CONTEXT_MENU_KIT}
      effects={effects}
    />
  )
}

/** A tab's right-click menu: where it sits in the grid, then the session's own entries. */
export function ItemTabMenu({
  item,
  resolved,
  tabCount,
  commands
}: {
  item: SplitViewItem
  resolved: ResolvedSplitViewItem | null
  tabCount: number
  commands: ItemTabCommands
}): React.JSX.Element {
  const t = useTranslate()
  const { moveToNewPane, closeOthers } = commands
  return (
    <>
      {moveToNewPane ? (
        <SplitViewPlacementMenu
          menuKind="context"
          intent="move"
          // A pane's only tab has nothing to split from.
          disabled={tabCount <= 1}
          onPlace={(zone) => zone !== 'center' && moveToNewPane(item, zone)}
        />
      ) : null}
      {closeOthers ? (
        <>
          <ContextMenuItem data-item-tab-menu="close" onSelect={() => commands.close(item)}>
            <X className="size-3.5" />
            {t('auto.components.tab.bar.SortableTabContextMenu.89359a36f7', 'Close')}
          </ContextMenuItem>
          <ContextMenuItem
            inset
            data-item-tab-menu="close-others"
            onSelect={() => closeOthers(item)}
            disabled={tabCount <= 1}
          >
            {t('auto.components.tab.bar.SortableTabContextMenu.8d16f9cd30', 'Close Others')}
          </ContextMenuItem>
          <CloseSplitPaneMenuItem
            menuKind="context"
            onCloseSplitPane={commands.closePane}
            label={t('seal.splitView.pane.close', 'Close pane')}
          />
        </>
      ) : null}
      {resolved?.kind === 'session' ? (
        <>
          {closeOthers ? <ContextMenuSeparator /> : null}
          <SessionTabMenuItems
            session={resolved.session}
            splitOwnPane={moveToNewPane && tabCount > 1 ? () => moveToNewPane(item, 'right') : null}
          />
        </>
      ) : null}
    </>
  )
}
