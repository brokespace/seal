import { useId } from 'react'
import type { SealMcpMachine } from '../../../../../shared/seal-mcp/seal-mcp-types'
import { HostListOverflowNote } from '../../host-picker/HostListOverflowNote'
import { HostListSearchField } from '../../host-picker/HostListSearchField'
import { noHostsMatchLabel } from '../../host-picker/host-picker-copy'
import { useBoundedHostRows } from '../../host-picker/use-bounded-host-rows'
import { useTranslate } from '@/i18n/use-translate'
import { Checkbox } from '../../ui/checkbox'
import { Label } from '../../ui/label'

function MachineRow({
  machine,
  checked,
  onChange
}: {
  machine: SealMcpMachine
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex items-center gap-2.5">
      <Checkbox id={id} checked={checked} onCheckedChange={(next) => onChange(next === true)} />
      <Label htmlFor={id}>{machine.label}</Label>
    </div>
  )
}

/** The machines a client may be limited to; ticked ones stay in view however long the list is. */
export function McpMachineChecklist({
  machines,
  selectedIds,
  onToggle
}: {
  machines: readonly SealMcpMachine[]
  selectedIds: readonly string[]
  onToggle: (id: string, selected: boolean) => void
}): React.JSX.Element {
  const t = useTranslate()
  const rows = useBoundedHostRows(machines, new Set(selectedIds))
  return (
    <div className="rounded-md border border-border">
      {rows.searchable ? <HostListSearchField value={rows.query} onChange={rows.setQuery} /> : null}
      <div className="grid max-h-40 gap-2 overflow-y-auto p-2.5 scrollbar-sleek">
        {rows.shown.length === 0 ? (
          <p className="text-xs text-muted-foreground">{noHostsMatchLabel(t)}</p>
        ) : null}
        {rows.shown.map((machine) => (
          <MachineRow
            key={machine.id}
            machine={machine}
            checked={selectedIds.includes(machine.id)}
            onChange={(on) => onToggle(machine.id, on)}
          />
        ))}
      </div>
      <HostListOverflowNote hiddenCount={rows.hiddenCount} />
    </div>
  )
}
