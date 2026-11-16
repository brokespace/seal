import { Server } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { HostListOverflowNote } from '../host-picker/HostListOverflowNote'
import { HostListSearchField } from '../host-picker/HostListSearchField'
import { useBoundedHostRows } from '../host-picker/use-bounded-host-rows'
import { MachineStatusDot, useMachineStatusLabel } from '../machines/detail/MachineVitals'
import type {
  HomeChatMachineOption,
  HomeChatSummary
} from '../../../../shared/home-chat/home-chat-types'

function MachinesPopover({
  current,
  machines,
  onOpen
}: {
  current: string | null
  machines: readonly HomeChatMachineOption[]
  onOpen: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const statusLabel = useMachineStatusLabel()
  const local = machines.find((machine) => machine.kind === 'local')
  const label = current ?? local?.label ?? t('homeChat.context.thisComputer', 'This computer')
  const online = machines.filter((machine) => machine.status === 'online').length
  const rows = useBoundedHostRows(machines)

  return (
    <Popover onOpenChange={(open) => open && onOpen()}>
      <PopoverTrigger asChild>
        <Button
          size="xs"
          variant="muted-field-icon"
          className="min-w-0"
          data-home-chat-machine={label}
          aria-label={t('homeChat.context.machine', 'Machine: {{machine}}', { machine: label })}
        >
          <Server />
          <span className="max-w-40 truncate">{label}</span>
          {machines.length > 1 && (
            <span className="tabular-nums text-muted-foreground/70">
              {t('homeChat.context.online', '· {{online}} of {{total}} machines online', {
                online,
                total: machines.length
              })}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
          {t('homeChat.context.machinesTitle', 'Machines the assistant can reach')}
        </p>
        {rows.searchable && <HostListSearchField value={rows.query} onChange={rows.setQuery} />}
        <ul className="scrollbar-sleek max-h-64 space-y-0.5 overflow-y-auto px-2 pb-2">
          {rows.shown.map((machine) => (
            <li
              key={machine.id}
              className="flex items-center gap-2 rounded-md px-1 py-1 text-xs"
              data-home-chat-machine-row={machine.label}
            >
              <MachineStatusDot status={machine.status} />
              <span className="min-w-0 flex-1 truncate text-foreground">{machine.label}</span>
              {machine.address && (
                <span className="max-w-28 truncate font-mono text-muted-foreground">
                  {machine.address}
                </span>
              )}
              <span className="shrink-0 text-muted-foreground">{statusLabel(machine.status)}</span>
            </li>
          ))}
        </ul>
        <HostListOverflowNote hiddenCount={rows.hiddenCount} />
      </PopoverContent>
    </Popover>
  )
}

/** Where the assistant is working. */
export function HomeChatContextBar({
  chat,
  machines,
  onOpenMachines
}: {
  chat: HomeChatSummary | null
  machines: readonly HomeChatMachineOption[]
  onOpenMachines: () => void
}): React.JSX.Element {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
      <MachinesPopover
        current={chat?.lastMachine ?? null}
        machines={machines}
        onOpen={onOpenMachines}
      />
    </div>
  )
}
