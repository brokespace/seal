import React, { useMemo, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { AddMachineDialog, AddMachineMenu, type AddMachineRequest } from './add/AddMachineFlow'
import { cn } from '@/lib/class-names'
import type { MachineId } from '../../../../shared/machines/machine-types'
import { MachineDetail } from './detail/MachineDetail'
import { MachineList } from './list/MachineList'
import { useMachineMetricsEntries, useMachineMetricsPolling } from './model/machine-metrics-store'
import { getLastSelectedMachineId, rememberMachineSelection } from './model/machine-selection'
import { useLiveSessions } from '../live-sessions/live-session-registry-store'
import { activeLiveSessionsByMachine } from './model/machine-live-sessions'
import { useLocalMachineName } from './model/use-local-machine-name'
import { useMachinesInventory } from './model/use-machines-inventory'
import { MachineTransfersPanel } from './transfers/MachineTransfersPanel'
import { useMachineTransfers } from './transfers/use-machine-transfers'

export default function MachinesPage(): React.JSX.Element {
  const t = useTranslate()
  const { machines, reload } = useMachinesInventory(useLocalMachineName())
  const metricsById = useMachineMetricsEntries()
  useMachineMetricsPolling(machines)
  const { sessions } = useLiveSessions()
  const sessionsByMachine = useMemo(
    () => activeLiveSessionsByMachine(machines, sessions),
    [machines, sessions]
  )
  const { transfers, clearFinished } = useMachineTransfers()
  const [selectedId, setSelectedId] = useState<MachineId | null>(getLastSelectedMachineId)
  // Narrow layouts show one pane at a time; this tracks whether the detail pane is in front.
  const [showDetailOnNarrow, setShowDetailOnNarrow] = useState(
    () => getLastSelectedMachineId() !== null
  )
  const [adding, setAdding] = useState<AddMachineRequest | null>(null)

  const selected = machines.find((machine) => machine.id === selectedId) ?? machines[0] ?? null
  const sessionCountById = useMemo(
    () => new Map([...sessionsByMachine].map(([id, sessions]) => [id, sessions.length])),
    [sessionsByMachine]
  )
  const select = (id: MachineId): void => {
    rememberMachineSelection(id)
    setSelectedId(id)
    setShowDetailOnNarrow(true)
  }
  const selectedMetrics = selected ? metricsById.get(selected.id) : undefined

  return (
    <main
      className="relative flex h-full min-h-0 flex-col bg-background pt-5 text-foreground md:pt-6"
      data-machines-page
    >
      <header className="flex shrink-0 items-center gap-2 px-3 pb-3 md:px-5">
        <h1 className="min-w-0 flex-1 truncate text-base leading-8 font-semibold">
          {t('auto.components.machines.page.title', 'Machines')}
        </h1>
        <AddMachineMenu onPick={(mode) => setAdding({ mode, machineId: null })} />
      </header>
      <div className="flex min-h-0 flex-1 border-t border-border">
        <aside
          className={cn(
            'scrollbar-sleek min-h-0 w-full shrink-0 overflow-y-auto border-r border-border md:block md:w-72',
            showDetailOnNarrow && selected ? 'hidden' : 'block'
          )}
          aria-label={t('auto.components.machines.page.list', 'Machines')}
        >
          <MachineList
            machines={machines}
            metricsById={metricsById}
            sessionCountById={sessionCountById}
            selectedId={selected?.id ?? null}
            onSelect={select}
          />
        </aside>
        <div
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col md:flex',
            showDetailOnNarrow && selected ? 'flex' : 'hidden'
          )}
        >
          {selected ? (
            <MachineDetail
              machine={selected}
              metrics={selectedMetrics?.metrics ?? null}
              metricsError={selectedMetrics?.error ?? null}
              sessions={sessionsByMachine.get(selected.id) ?? []}
              onBack={() => setShowDetailOnNarrow(false)}
              onChanged={reload}
            />
          ) : null}
        </div>
      </div>
      <MachineTransfersPanel transfers={transfers} onClearFinished={clearFinished} />
      <AddMachineDialog
        request={adding}
        onClose={() => {
          setAdding(null)
          reload()
        }}
        onAdopted={reload}
      />
    </main>
  )
}
