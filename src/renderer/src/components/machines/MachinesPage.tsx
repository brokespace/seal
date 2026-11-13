import React, { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { AddRemoteHostDialog } from '@/components/sidebar/host-admission/ssh/AddRemoteHostDialog'
import { cn } from '@/lib/class-names'
import type { MachineId } from '../../../../shared/machines/machine-types'
import { MachineDetail } from './detail/MachineDetail'
import { MachineList } from './list/MachineList'
import { useMachineMetricsEntries, useMachineMetricsPolling } from './model/machine-metrics-store'
import { useMachineAgentSessions } from './model/use-machine-agent-sessions'
import { groupSessionsByMachine } from './model/machine-agent-sessions'
import { useMachinesInventory } from './model/use-machines-inventory'
import { MachineTransfersPanel } from './transfers/MachineTransfersPanel'
import { useMachineTransfers } from './transfers/use-machine-transfers'

// Reopening the page returns to the machine the user was last looking at.
let lastSelectedMachineId: MachineId | null = null

export default function MachinesPage(): React.JSX.Element {
  const t = useTranslate()
  const { machines, reload } = useMachinesInventory(
    t('auto.components.machines.page.localName', 'This computer')
  )
  const metricsById = useMachineMetricsEntries()
  useMachineMetricsPolling(machines)
  const sessionsByHost = useMachineAgentSessions()
  const sessionsByMachine = useMemo(
    () => groupSessionsByMachine(machines, sessionsByHost),
    [machines, sessionsByHost]
  )
  const { transfers, clearFinished } = useMachineTransfers()
  const [selectedId, setSelectedId] = useState<MachineId | null>(lastSelectedMachineId)
  // Narrow layouts show one pane at a time; this tracks whether the detail pane is in front.
  const [showDetailOnNarrow, setShowDetailOnNarrow] = useState(lastSelectedMachineId !== null)
  const [adding, setAdding] = useState(false)

  const selected = machines.find((machine) => machine.id === selectedId) ?? machines[0] ?? null
  const sessionCountById = useMemo(
    () => new Map([...sessionsByMachine].map(([id, sessions]) => [id, sessions.length])),
    [sessionsByMachine]
  )
  const select = (id: MachineId): void => {
    lastSelectedMachineId = id
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
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus />
          {t('auto.components.machines.page.add', 'Add machine')}
        </Button>
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
      <AddRemoteHostDialog
        mode={adding ? 'ssh' : null}
        onOpenChange={(mode) => {
          setAdding(mode !== null)
          if (mode === null) {
            reload()
          }
        }}
      />
    </main>
  )
}
