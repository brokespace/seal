import { Monitor, TriangleAlert } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { useSessionMachineName } from '@/components/machines/model/use-local-machine-name'
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
import { liveSessionDotState, liveSessionStatusLabel } from '../live-session-presentation'
import type { SessionMachineOption } from './sidebar-sessions-toolbar-model'

export type SessionMachineFilterProps = {
  machines: readonly SessionMachineOption[]
  /** Active sessions on every machine. */
  total: number
  /** The chosen machine's host id; null lists every machine. */
  selected: string | null
  onChange: (hostId: string | null) => void
}

// Why not a word: a host id can be any non-empty string.
const EVERY_MACHINE = ''

const COUNT = 'shrink-0 text-xs text-muted-foreground tabular-nums'

/** Narrows the sidebar's session rows to one machine, and says which machines could not be scanned. */
export function SessionMachineFilter(props: SessionMachineFilterProps): React.JSX.Element {
  const t = useTranslate()
  const machineName = useSessionMachineName()
  const { machines, selected } = props
  const label = t(
    'auto.components.live-sessions.sessionRows.filterByMachine',
    'Filter sessions by machine'
  )
  const scanError = (machine: SessionMachineOption): string =>
    t('auto.components.live-sessions.sidebar.hostError', 'Could not scan {{host}}: {{error}}', {
      host: machineName(machine.machine),
      error: machine.error ?? ''
    })
  const failing = machines.filter((machine) => machine.error !== null)
  return (
    <DropdownMenu modal={false}>
      {failing.length > 0 ? (
        <span
          role="img"
          data-session-machine-filter-warning
          title={failing.map(scanError).join('\n')}
          aria-label={t(
            'auto.components.live-sessions.sessionRows.scanFailed',
            'Some machines could not be scanned'
          )}
          className="flex shrink-0"
        >
          <TriangleAlert className="size-3 text-agent-question-text" />
        </span>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              data-session-machine-filter
              data-active={selected !== null}
              aria-label={label}
              className="relative"
            >
              <Monitor className="size-3.5" strokeWidth={2.25} />
              <OptionsFilterCountBadge count={selected === null ? 0 : 1} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuRadioGroup
          value={selected ?? EVERY_MACHINE}
          onValueChange={(hostId) => props.onChange(hostId === EVERY_MACHINE ? null : hostId)}
        >
          <DropdownMenuRadioItem value={EVERY_MACHINE} data-machine-filter-option="all">
            <span className="min-w-0 flex-1 truncate">
              {t('auto.components.live-sessions.sessionRows.allMachines', 'All machines')}
            </span>
            <span className={COUNT}>{props.total}</span>
          </DropdownMenuRadioItem>
          {machines.length > 0 ? <DropdownMenuSeparator /> : null}
          {machines.map((machine) => (
            <DropdownMenuRadioItem
              key={machine.hostId}
              value={machine.hostId}
              data-machine-filter-option={machine.hostId}
              data-machine-filter-error={machine.error === null ? undefined : ''}
              title={machine.error === null ? undefined : scanError(machine)}
              className="items-start"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" title={machine.machine.label}>
                    {machineName(machine.machine)}
                  </span>
                  {machine.error === null ? null : (
                    <TriangleAlert className="size-3 text-agent-question-text" aria-hidden="true" />
                  )}
                  {machine.topStatus ? (
                    <AgentStateDot
                      state={liveSessionDotState(machine.topStatus)}
                      title={liveSessionStatusLabel(machine.topStatus)}
                    />
                  ) : null}
                  <span className={COUNT}>{machine.count}</span>
                </span>
                {machine.error === null ? null : (
                  <span className="text-2xs break-words text-muted-foreground">
                    {scanError(machine)}
                  </span>
                )}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
