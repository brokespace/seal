import { X } from 'lucide-react'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import {
  CONTEXT_MENU_KIT,
  LiveSessionMenuItems
} from '@/components/live-sessions/menu/LiveSessionMenuItems'
import { CloseSplitPaneMenuItem } from '@/components/tab-bar/CloseSplitPaneMenuItem'
import { useTranslate } from '@/i18n/use-translate'
import type { ItemTabCommands } from './ItemTabStrip'
import type { ResolvedSplitViewItem } from './split-view-item-resolution'
import { SplitViewPlacementMenu } from './SplitViewPlacementMenu'
import type { SplitViewItem } from './split-view-types'

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
          <LiveSessionMenuItems session={resolved.session} kit={CONTEXT_MENU_KIT} />
        </>
      ) : null}
    </>
  )
}
