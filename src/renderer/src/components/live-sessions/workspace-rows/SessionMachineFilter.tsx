import { Monitor, TriangleAlert } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { noHostsMatchLabel } from '@/components/host-picker/host-picker-copy'
import { HostListOverflowNote } from '@/components/host-picker/HostListOverflowNote'
import { HostListSearchField } from '@/components/host-picker/HostListSearchField'
import { useBoundedHostRows } from '@/components/host-picker/use-bounded-host-rows'
import { useSessionMachineName } from '@/components/machines/model/use-local-machine-name'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { liveSessionDotState, liveSessionStatusLabel } from '../live-session-presentation'
import { SESSION_FILTER_COUNT_CLASS, SessionFilterTrigger } from './SessionFilterTrigger'
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
  // Every configured host whose scan failed is listed, so the list is bounded; the chosen one stays in it.
  const rows = useBoundedHostRows(
    machines.map((option) => ({ id: option.hostId, label: machineName(option.machine), option })),
    selected === null ? undefined : new Set([selected])
  )
  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          rows.setQuery('')
        }
      }}
    >
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
      <SessionFilterTrigger filter="machine" label={label} active={selected !== null}>
        <Monitor className="size-3.5" strokeWidth={2.25} />
      </SessionFilterTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuRadioGroup
          value={selected ?? EVERY_MACHINE}
          onValueChange={(hostId) => props.onChange(hostId === EVERY_MACHINE ? null : hostId)}
        >
          <DropdownMenuRadioItem value={EVERY_MACHINE} data-machine-filter-option="all">
            <span className="min-w-0 flex-1 truncate">
              {t('auto.components.live-sessions.sessionRows.allMachines', 'All machines')}
            </span>
            <span className={SESSION_FILTER_COUNT_CLASS}>{props.total}</span>
          </DropdownMenuRadioItem>
          {machines.length > 0 ? <DropdownMenuSeparator /> : null}
          {rows.searchable ? (
            <HostListSearchField value={rows.query} onChange={rows.setQuery} inMenu />
          ) : null}
          {/* One size while searching, note included: a menu that resizes moves under the pointer and drops the typing. */}
          <div
            className={cn(
              'flex flex-col',
              rows.searchable
                ? 'h-[min(23rem,calc(var(--radix-dropdown-menu-content-available-height)_-_6rem))]'
                : 'max-h-[min(20rem,calc(var(--radix-dropdown-menu-content-available-height)_-_4rem))]'
            )}
          >
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
              {rows.shown.map(({ option: machine, label: name }) => (
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
                      <span
                        className="min-w-0 flex-1 truncate"
                        // A machine known only by its id has no other name to add.
                        title={
                          machine.machine.label === machine.hostId
                            ? undefined
                            : machine.machine.label
                        }
                      >
                        {name}
                      </span>
                      {machine.error === null ? null : (
                        <TriangleAlert
                          className="size-3 text-agent-question-text"
                          aria-hidden="true"
                        />
                      )}
                      {machine.topStatus ? (
                        <AgentStateDot
                          state={liveSessionDotState(machine.topStatus)}
                          title={liveSessionStatusLabel(machine.topStatus)}
                        />
                      ) : null}
                      <span className={SESSION_FILTER_COUNT_CLASS}>{machine.count}</span>
                    </span>
                    {machine.error === null ? null : (
                      <span className="text-2xs break-words text-muted-foreground">
                        {scanError(machine)}
                      </span>
                    )}
                  </span>
                </DropdownMenuRadioItem>
              ))}
              {rows.shown.length === 0 && machines.length > 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {noHostsMatchLabel(t)}
                </div>
              ) : null}
            </div>
            <HostListOverflowNote hiddenCount={rows.hiddenCount} />
          </div>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
