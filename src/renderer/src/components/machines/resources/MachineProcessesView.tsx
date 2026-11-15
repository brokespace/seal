import React, { useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'
import type {
  MachineProcess,
  MachineProcessSnapshot
} from '../../../../../shared/machines/machine-resource-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { MachineGpuUnlistedProcesses } from './MachineGpuUnlistedProcesses'
import {
  MachineProcessList,
  type MachineProcessGpuUse,
  type MachineProcessSort
} from './MachineProcessList'
import { useLiveSessions } from '../../live-sessions/live-session-registry-store'
import { liveSessionsByPid } from '../model/machine-live-sessions'
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

/** A process on two GPUs is one row: its GPUs side by side and its memory on them added up. */
function gpuUseByPid(snapshot: MachineProcessSnapshot | null): Map<number, MachineProcessGpuUse> {
  const byPid = new Map<number, MachineProcessGpuUse>()
  for (const use of snapshot?.gpu?.processes ?? []) {
    const known = byPid.get(use.pid)
    const gpuIndexes = new Set(known?.gpuIndexes)
    if (use.gpuIndex !== null) {
      gpuIndexes.add(use.gpuIndex)
    }
    byPid.set(use.pid, {
      gpuIndexes: [...gpuIndexes].sort((a, b) => a - b),
      memoryBytes:
        use.memoryBytes === null && known?.memoryBytes == null
          ? null
          : (known?.memoryBytes ?? 0) + (use.memoryBytes ?? 0),
      container: known?.container ?? use.container
    })
  }
  return byPid
}

/** The filter also finds a GPU process by the container it runs in. */
function inContainer(use: MachineProcessGpuUse | undefined, filter: string): boolean {
  const needle = filter.trim().toLowerCase()
  const container = use?.container
  return (
    needle !== '' &&
    container != null &&
    (container.name?.toLowerCase().includes(needle) === true || container.id.startsWith(needle))
  )
}

/**
 * Live process table shared by the CPU, memory and GPU details, which differ in ranking and
 * headline. The GPU detail lists only the processes on the GPUs.
 */
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
  const onGpus = initialSort === 'gpu'
  const { snapshot, error, sampleNow } = useMachineProcesses(machine.id, onGpus)
  const { sessions } = useLiveSessions()
  const sessionsByPid = useMemo(() => liveSessionsByPid(machine, sessions), [machine, sessions])
  const [sort, setSort] = useState<MachineProcessSort>(initialSort)
  const [filter, setFilter] = useState('')
  const [signal, setSignal] = useState<MachineProcessSignalRequest | null>(null)
  const gpuUse = useMemo(() => (onGpus ? gpuUseByPid(snapshot) : undefined), [onGpus, snapshot])

  const listed = useMemo(
    () => (snapshot?.processes ?? []).filter((process) => !gpuUse || gpuUse.has(process.pid)),
    [snapshot, gpuUse]
  )
  const shown = useMemo(() => {
    const filtered = listed.filter(
      (process) => matches(process, filter) || inContainer(gpuUse?.get(process.pid), filter)
    )
    const gpuMemory = (process: MachineProcess): number =>
      gpuUse?.get(process.pid)?.memoryBytes ?? -1
    filtered.sort((a, b) =>
      sort === 'cpu'
        ? b.cpuPercent - a.cpuPercent
        : sort === 'gpu'
          ? gpuMemory(b) - gpuMemory(a) || a.pid - b.pid
          : b.rssBytes - a.rssBytes
    )
    return filter.trim() === '' ? filtered.slice(0, TOP_SHOWN) : filtered
  }, [listed, filter, sort, gpuUse])
  const unlisted = useMemo(
    () =>
      (snapshot?.gpu?.processes ?? []).filter(
        (use) => !snapshot?.processes.some((process) => process.pid === use.pid)
      ),
    [snapshot]
  )
  const errorLine = error ? (
    <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
      {error}
    </p>
  ) : null

  return (
    <div className="space-y-4">
      {/* Above the GPU readings: they are from the last sample that did arrive. */}
      {onGpus ? errorLine : null}
      {summary(snapshot)}
      {snapshot && !onGpus ? (
        <MachineProcessSessions
          snapshot={snapshot}
          sessionsByPid={sessionsByPid}
          filter={filter}
          onFilter={setFilter}
        />
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
              ? filter.trim() !== ''
                ? t('auto.components.machines.processes.showingMatches', '{{shown}} matching', {
                    shown: shown.length
                  })
                : onGpus
                  ? t(
                      'auto.components.machines.gpu.processCount',
                      '{{count}} processes using a GPU',
                      { count: listed.length, defaultValue_one: '{{count}} process using a GPU' }
                    )
                  : t(
                      'auto.components.machines.processes.showingTop',
                      'Top {{shown}} of {{total}} processes',
                      { shown: shown.length, total: snapshot.totalProcesses }
                    )
              : null}
          </span>
        </div>
        {onGpus || !errorLine ? null : <div className="pb-2">{errorLine}</div>}
        {snapshot ? (
          shown.length > 0 ? (
            <MachineProcessList
              processes={shown}
              sort={sort}
              onSort={setSort}
              onSignal={(process, kind) => setSignal({ process, signal: kind })}
              gpuUse={gpuUse}
            />
          ) : onGpus && listed.length === 0 ? (
            // What the driver reports but the machine does not list is in the note below.
            unlisted.length > 0 ? null : (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {t('auto.components.machines.gpu.noProcesses', 'No process is using a GPU.')}
              </p>
            )
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
        <MachineGpuUnlistedProcesses processes={unlisted} />
      </div>
      <MachineProcessSignalDialog
        machineId={machine.id}
        machineLabel={machine.label}
        request={signal}
        onClose={() => setSignal(null)}
        onSignalled={sampleNow}
      />
    </div>
  )
}
