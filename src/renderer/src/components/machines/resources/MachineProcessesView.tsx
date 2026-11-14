import React, { useMemo, useState } from 'react'
import { Loader2, Pause, Play, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'
import type {
  MachineProcess,
  MachineProcessSnapshot
} from '../../../../../shared/machines/machine-resource-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { MachineProcessList, type MachineProcessSort } from './MachineProcessList'
import { MachineProcessSessions } from './MachineProcessSessions'
import {
  MachineProcessSignalDialog,
  type MachineProcessSignalRequest
} from './MachineProcessSignalDialog'
import { useMachineProcesses } from './use-machine-processes'

/** The host sends its top 40 per ranking; showing more would rank processes it never compared. */
const TOP_SHOWN = 40

function matches(process: MachineProcess, filter: string): boolean {
  const needle = filter.trim().toLowerCase()
  return (
    needle === '' ||
    String(process.pid) === needle ||
    process.tmuxPane?.toLowerCase() === needle ||
    process.name.toLowerCase().includes(needle) ||
    process.command.toLowerCase().includes(needle) ||
    process.user.toLowerCase().includes(needle) ||
    (process.agent ?? '').includes(needle)
  )
}

/** Live process table shared by the CPU and memory details, which differ in ranking and headline. */
export function MachineProcessesView({
  machine,
  initialSort,
  summary,
  children
}: {
  machine: MachineSummary
  initialSort: MachineProcessSort
  summary: (snapshot: MachineProcessSnapshot | null) => React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  const { snapshot, error, paused, setPaused, refresh } = useMachineProcesses(machine.id)
  const [sort, setSort] = useState<MachineProcessSort>(initialSort)
  const [filter, setFilter] = useState('')
  const [signal, setSignal] = useState<MachineProcessSignalRequest | null>(null)

  const shown = useMemo(() => {
    const filtered = (snapshot?.processes ?? []).filter((process) => matches(process, filter))
    filtered.sort((a, b) =>
      sort === 'cpu' ? b.cpuPercent - a.cpuPercent : b.rssBytes - a.rssBytes
    )
    return filter.trim() === '' ? filtered.slice(0, TOP_SHOWN) : filtered
  }, [snapshot, filter, sort])

  return (
    <div className="space-y-4">
      {summary(snapshot)}
      {snapshot ? (
        <MachineProcessSessions snapshot={snapshot} filter={filter} onFilter={setFilter} />
      ) : null}
      {children}
      <div>
        <div className="flex items-center gap-2 pb-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:max-w-64">
            <Search className="size-3 shrink-0 text-muted-foreground" />
            <Input
              density="compact"
              className="min-w-0 flex-1"
              value={filter}
              placeholder={t(
                'auto.components.machines.processes.filter',
                'Filter by name, command, user, or pid'
              )}
              aria-label={t('auto.components.machines.processes.filterLabel', 'Filter processes')}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
            {snapshot
              ? filter.trim() === ''
                ? t(
                    'auto.components.machines.processes.showingTop',
                    'Top {{shown}} of {{total}} processes',
                    { shown: shown.length, total: snapshot.totalProcesses }
                  )
                : t('auto.components.machines.processes.showingMatches', '{{shown}} matching', {
                    shown: shown.length
                  })
              : null}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-2xs text-muted-foreground">
            {paused ? (
              t('auto.components.machines.processes.paused', 'Paused')
            ) : (
              <>
                <span className="size-1.5 animate-pulse rounded-full bg-status-success" />
                {t('auto.components.machines.processes.live', 'Live')}
              </>
            )}
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={() => setPaused(!paused)}>
            {paused ? <Play /> : <Pause />}
            {paused
              ? t('auto.components.machines.processes.resume', 'Resume')
              : t('auto.components.machines.processes.pause', 'Pause')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('auto.components.machines.processes.refresh', 'Refresh now')}
            onClick={refresh}
          >
            <RefreshCw />
          </Button>
        </div>
        {error ? (
          <p className="pb-2 text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
            {error}
          </p>
        ) : null}
        {snapshot ? (
          shown.length > 0 ? (
            <MachineProcessList
              processes={shown}
              sort={sort}
              onSort={setSort}
              onSignal={(process, kind) => setSignal({ process, signal: kind })}
            />
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {t('auto.components.machines.processes.noMatches', 'No process matches.')}
            </p>
          )
        ) : error ? null : (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      <MachineProcessSignalDialog
        machineId={machine.id}
        machineLabel={machine.label}
        request={signal}
        onClose={() => setSignal(null)}
        onSignalled={refresh}
      />
    </div>
  )
}
