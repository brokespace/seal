import { Columns2, PanelBottom, PanelLeft, PanelRight, PanelTop, SquarePlus } from 'lucide-react'
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import type { SplitViewZone } from './split-view-types'

const CONTEXT_KIT = {
  Item: ContextMenuItem,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent
}
const DROPDOWN_KIT = {
  Item: DropdownMenuItem,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent
}

const ZONE_ICONS = {
  right: PanelRight,
  down: PanelBottom,
  left: PanelLeft,
  up: PanelTop,
  center: SquarePlus
} as const

const EDGES: readonly SplitViewZone[] = ['right', 'down', 'left', 'up']

/**
 * The menu twin of a drop: "Open in split view" on sidebar rows (edges and "As a tab"), and
 * "Move to new pane" on a tab (edges only).
 */
export function SplitViewPlacementMenu({
  menuKind,
  intent,
  disabled,
  onPlace
}: {
  menuKind: 'context' | 'dropdown'
  intent: 'open' | 'move'
  disabled?: boolean
  onPlace: (zone: SplitViewZone) => void
}): React.JSX.Element {
  const t = useTranslate()
  const { Item, Sub, SubTrigger, SubContent } = menuKind === 'context' ? CONTEXT_KIT : DROPDOWN_KIT
  const zoneLabel = (zone: SplitViewZone): string => {
    switch (zone) {
      case 'right':
        return t('seal.splitView.menu.right', 'Right')
      case 'down':
        return t('seal.splitView.menu.down', 'Down')
      case 'left':
        return t('seal.splitView.menu.left', 'Left')
      case 'up':
        return t('seal.splitView.menu.up', 'Up')
      case 'center':
        return t('seal.splitView.menu.asTab', 'As a tab')
    }
  }
  return (
    <Sub>
      <SubTrigger data-split-view-placement-menu={intent} disabled={disabled}>
        <Columns2 className="size-3.5" />
        {intent === 'open'
          ? t('seal.splitView.menu.openInSplitView', 'Open in split view')
          : t('seal.splitView.menu.moveToNewPane', 'Move to new pane')}
      </SubTrigger>
      <SubContent>
        {(intent === 'open' ? [...EDGES, 'center' as const] : EDGES).map((zone) => {
          const Icon = ZONE_ICONS[zone]
          return (
            <Item key={zone} data-split-view-place={zone} onSelect={() => onPlace(zone)}>
              <Icon className="size-3.5" />
              {zoneLabel(zone)}
            </Item>
          )
        })}
      </SubContent>
    </Sub>
  )
}
