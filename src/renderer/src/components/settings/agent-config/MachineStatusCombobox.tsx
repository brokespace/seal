import React from 'react'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { HostCombobox } from '../../host-picker/HostCombobox'
import { MachineStatusDot } from '../../machines/detail/MachineVitals'

/** Picks one of the saved machines, each shown with its connection dot. */
export function MachineStatusCombobox({
  machines,
  value,
  onChange,
  ariaLabel
}: {
  machines: readonly MachineSummary[]
  value: string
  onChange: (machineId: string) => void
  ariaLabel: string
}): React.JSX.Element {
  return (
    <HostCombobox
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
      options={machines.map((item) => ({
        id: item.id,
        label: item.label,
        content: (
          <span className="flex min-w-0 items-center gap-2">
            <MachineStatusDot status={item.status} />
            <span className="truncate">{item.label}</span>
          </span>
        )
      }))}
    />
  )
}
