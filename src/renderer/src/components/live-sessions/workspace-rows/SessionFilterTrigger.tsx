import { OptionsFilterCountBadge } from '@/components/sidebar/worktree-list/controls/options-filter-count-badge'
import { Button } from '@/components/ui/button'
import { DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** A count at the end of a filter menu's line. */
export const SESSION_FILTER_COUNT_CLASS = 'shrink-0 text-xs text-muted-foreground tabular-nums'

/** A sessions filter's button in the toolbar: its icon, a mark while it narrows the rows, its name on hover. */
export function SessionFilterTrigger({
  filter,
  label,
  active,
  children
}: {
  filter: 'machine' | 'status'
  label: string
  active: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            {...{ [`data-session-${filter}-filter`]: true }}
            data-active={active}
            aria-label={label}
            className="relative"
          >
            {children}
            <OptionsFilterCountBadge count={active ? 1 : 0} />
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
