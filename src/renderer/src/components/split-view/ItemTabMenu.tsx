import { X } from 'lucide-react'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { CloseSplitPaneMenuItem } from '@/components/tab-bar/CloseSplitPaneMenuItem'
import { useTranslate } from '@/i18n/use-translate'
import type { ItemTabCommands } from './item-tab-commands'
import { SplitViewPlacementMenu } from './SplitViewPlacementMenu'
import type { SplitViewItem } from './split-view-types'

/** A tab's right-click menu: where it sits in the grid. */
export function ItemTabMenu({
  item,
  tabCount,
  commands
}: {
  item: SplitViewItem
  tabCount: number
  commands: ItemTabCommands
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <>
      <SplitViewPlacementMenu
        menuKind="context"
        intent="move"
        // A pane's only tab has nothing to split from.
        disabled={tabCount <= 1}
        onPlace={(zone) => zone !== 'center' && commands.moveToNewPane(item, zone)}
      />
      <ContextMenuItem data-item-tab-menu="close" onSelect={() => commands.close(item)}>
        <X className="size-3.5" />
        {t('auto.components.tab.bar.SortableTabContextMenu.89359a36f7', 'Close')}
      </ContextMenuItem>
      <ContextMenuItem
        inset
        data-item-tab-menu="close-others"
        onSelect={() => commands.closeOthers(item)}
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
  )
}
