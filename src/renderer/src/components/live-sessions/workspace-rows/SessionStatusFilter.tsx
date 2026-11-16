import { ListFilter } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { OptionsFilterCountBadge } from '@/components/sidebar/worktree-list/controls/options-filter-count-badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { liveSessionDotState } from '../live-session-presentation'
import {
  SIDEBAR_SESSION_STATUS_FILTERS,
  type SidebarSessionStatusFilter
} from './sidebar-session-filter-store'
import {
  SIDEBAR_SESSION_STATUS_FILTER_SAMPLES,
  sidebarSessionStatusFilterLabel
} from './sidebar-sessions-toolbar-model'

export type SessionStatusFilterProps = {
  /** Active sessions per status group, on the chosen machine. */
  counts: Readonly<Record<SidebarSessionStatusFilter, number>>
  selected: SidebarSessionStatusFilter | null
  onChange: (status: SidebarSessionStatusFilter | null) => void
}

const EVERY_STATUS = 'all'

const COUNT = 'shrink-0 text-xs text-muted-foreground tabular-nums'

/** Narrows the sidebar's session rows to the ones that need the user, are working or sit idle. */
export function SessionStatusFilter(props: SessionStatusFilterProps): React.JSX.Element {
  const t = useTranslate()
  const { counts, selected } = props
  const label = t(
    'auto.components.live-sessions.sessionRows.filterByStatus',
    'Filter sessions by status'
  )
  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              data-session-status-filter
              data-active={selected !== null}
              aria-label={label}
              className="relative"
            >
              <ListFilter className="size-3.5" strokeWidth={2.25} />
              <OptionsFilterCountBadge count={selected === null ? 0 : 1} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuRadioGroup
          value={selected ?? EVERY_STATUS}
          onValueChange={(value) =>
            props.onChange(
              SIDEBAR_SESSION_STATUS_FILTERS.find((status) => status === value) ?? null
            )
          }
        >
          <DropdownMenuRadioItem value={EVERY_STATUS} data-status-filter-option="all">
            {/* Keeps the label in line with the ones that follow a status dot. */}
            <span className="size-2.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              {t('auto.components.live-sessions.sessionRows.allStatuses', 'All statuses')}
            </span>
            <span className={COUNT}>
              {SIDEBAR_SESSION_STATUS_FILTERS.reduce((sum, status) => sum + counts[status], 0)}
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {SIDEBAR_SESSION_STATUS_FILTERS.map((status) => (
            <DropdownMenuRadioItem key={status} value={status} data-status-filter-option={status}>
              <AgentStateDot
                state={liveSessionDotState(SIDEBAR_SESSION_STATUS_FILTER_SAMPLES[status])}
                title={null}
              />
              <span className="min-w-0 flex-1 truncate">
                {sidebarSessionStatusFilterLabel(status)}
              </span>
              <span className={COUNT}>{counts[status]}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
