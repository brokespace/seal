import React, { useMemo } from 'react'
import { HostListOverflowNote } from '@/components/host-picker/HostListOverflowNote'
import { HostListSearchField } from '@/components/host-picker/HostListSearchField'
import { useBoundedHostRows } from '@/components/host-picker/use-bounded-host-rows'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host'
import { Bot, Laptop, Server, Cloud } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { MachineId, MachineMetrics } from '../../../../../shared/machines/machine-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import {
  MachineMeter,
  MachineStatusDot,
  machineMeterValues,
  machineOsLabel,
  useMachineStatusLabel
} from '../detail/MachineVitals'

const CONNECTION_ICON = { local: Laptop, ssh: Server, server: Cloud }

function MachineListItem({
  machine,
  metrics,
  sessionCount,
  selected,
  onSelect
}: {
  machine: MachineSummary
  metrics: MachineMetrics | null
  sessionCount: number
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const statusLabel = useMachineStatusLabel()
  const Icon = CONNECTION_ICON[machine.connection]
  const values = machineMeterValues(metrics)
  const os = machineOsLabel(metrics?.os ?? machine.os)
  const subtitle = [machine.address, os].filter(Boolean).join(' · ')
  const showMeters = machine.status === 'online' && metrics !== null
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        data-machine-id={machine.id}
        className={cn(
          'flex w-full flex-col gap-2 rounded-md px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
          selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
        )}
        onClick={onSelect}
      >
        <div className="flex w-full min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{machine.label}</span>
          {sessionCount > 0 ? (
            <span
              className="flex shrink-0 items-center gap-0.5 text-2xs text-muted-foreground tabular-nums"
              title={t('auto.components.machines.list.sessions', '{{count}} running agents', {
                count: sessionCount
              })}
            >
              <Bot className="size-3" />
              {sessionCount}
            </span>
          ) : null}
          <MachineStatusDot status={machine.status} />
          <span className="sr-only">{statusLabel(machine.status)}</span>
        </div>
        {subtitle || machine.statusDetail ? (
          <span
            className={cn(
              'truncate pl-6 text-2xs',
              machine.status === 'error' ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {machine.status === 'error' && machine.statusDetail ? machine.statusDetail : subtitle}
          </span>
        ) : null}
        {showMeters ? (
          <div className="grid w-full grid-cols-3 gap-2 pl-6">
            <MachineMeter
              compact
              label={t('auto.components.machines.vitals.cpu', 'CPU')}
              percent={values.cpu}
            />
            <MachineMeter
              compact
              label={t('auto.components.machines.vitals.memory', 'RAM')}
              percent={values.memory}
            />
            <MachineMeter
              compact
              label={t('auto.components.machines.vitals.disk', 'Disk')}
              percent={values.disk}
            />
          </div>
        ) : null}
      </button>
    </li>
  )
}

export function MachineList({
  machines,
  metricsById,
  sessionCountById,
  selectedId,
  onSelect
}: {
  machines: readonly MachineSummary[]
  metricsById: ReadonlyMap<MachineId, { metrics: MachineMetrics | null }>
  sessionCountById: ReadonlyMap<MachineId, number>
  selectedId: MachineId | null
  onSelect: (id: MachineId) => void
}): React.JSX.Element {
  const pinned = useMemo(
    () =>
      new Set<string>(
        selectedId ? [LOCAL_EXECUTION_HOST_ID, selectedId] : [LOCAL_EXECUTION_HOST_ID]
      ),
    [selectedId]
  )
  // A generated ~/.ssh/config can import thousands of hosts; only a bounded, searchable slice renders.
  const rows = useBoundedHostRows(machines, pinned)
  return (
    <>
      {rows.searchable ? (
        <div className="px-1 pt-1">
          <HostListSearchField value={rows.query} onChange={rows.setQuery} />
        </div>
      ) : null}
      <ul className="space-y-0.5 p-2">
        {rows.shown.map((machine) => (
          <MachineListItem
            key={machine.id}
            machine={machine}
            metrics={metricsById.get(machine.id)?.metrics ?? null}
            sessionCount={sessionCountById.get(machine.id) ?? 0}
            selected={machine.id === selectedId}
            onSelect={() => onSelect(machine.id)}
          />
        ))}
      </ul>
      <HostListOverflowNote hiddenCount={rows.hiddenCount} />
    </>
  )
}
