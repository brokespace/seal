import React, { useMemo, useState } from 'react'
import { Gpu, RotateCw, Square } from 'lucide-react'
import { PageCard } from '@/components/page-layout/PageCard'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { MachineDockerDetailTarget } from '../../../../../shared/machines/machine-docker-types'
import type { MachineGpuProcess } from '../../../../../shared/machines/machine-gpu-types'
import type {
  MachineDockerContainer,
  MachineDockerContainers
} from '../../../../../shared/machines/machine-resource-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { formatBytes, formatBytesOfTotal } from '../model/machine-format'
import { formatGpuIndexes } from '../model/machine-gpu-format'
import { MachineDiskRowAction } from './MachineDiskRowAction'
import {
  MachineDockerContainerDialog,
  type MachineDockerContainerRequest
} from './MachineDockerContainerDialog'
import { MachineDockerDetailSheet } from './MachineDockerDetailSheet'
import { MachineProcessTag, type MachineProcessSort } from './MachineProcessList'
import { MachineSortHeader } from './MachineSortHeader'
import {
  gpuIndexesByContainer,
  gpuIndexesOfContainer,
  rankDockerContainers,
  type MachineDockerStatsSort
} from './machine-docker-container-stats'
import { useMachineDockerContainers } from './use-machine-docker-containers'

// Network, block I/O and PIDs sit beside the other figures in a wide pane and under them in a
// narrow one, where the header's second line keeps them in columns.
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_3.5rem_7rem_3.25rem] items-center gap-x-2 @3xl:grid-cols-[minmax(0,1fr)_3.5rem_10rem_8.5rem_8.5rem_2.75rem_3.25rem]'
const NAME_CELL = 'col-start-1 row-start-1 min-w-0'
const CPU_CELL = 'col-start-2 row-start-1 text-right'
const MEMORY_CELL = 'col-start-3 row-start-1 text-right'
const ACTIONS_CELL = 'col-start-4 row-start-1 @3xl:col-start-7'
const SECOND_LINE =
  'col-span-full row-start-2 flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 @3xl:contents'
const NET_CELL = 'w-28 shrink-0 text-right @3xl:col-start-4 @3xl:row-start-1 @3xl:w-auto'
const BLOCK_CELL = 'w-28 shrink-0 text-right @3xl:col-start-5 @3xl:row-start-1 @3xl:w-auto'
const PIDS_CELL = 'w-10 shrink-0 text-right @3xl:col-start-6 @3xl:row-start-1 @3xl:w-auto'
const SECOND_LINE_FIGURE =
  'font-mono text-2xs whitespace-nowrap text-muted-foreground tabular-nums @3xl:text-xs @3xl:text-foreground'

function useUnreachableText(docker: MachineDockerContainers | null): string | null {
  const t = useTranslate()
  if (docker?.state !== 'unreachable') {
    return null
  }
  return docker.reason === 'permission'
    ? t(
        'auto.components.machines.containers.noPermission',
        'Docker is installed, but this account cannot use it.'
      )
    : docker.reason === 'not-running'
      ? t(
          'auto.components.machines.containers.notRunning',
          'Docker is installed, but its daemon is not running.'
        )
      : docker.message
}

function pair(first: number | null, second: number | null): string {
  return first === null && second === null ? '—' : `${formatBytes(first)} / ${formatBytes(second)}`
}

function ContainerRow({
  container,
  gpuIndexes,
  onOpen,
  onAsk
}: {
  container: MachineDockerContainer
  gpuIndexes: number[] | undefined
  onOpen: () => void
  onAsk: (action: MachineDockerContainerRequest['action']) => void
}): React.JSX.Element {
  const t = useTranslate()
  const percent = container.memPercent === null ? null : `${container.memPercent.toFixed(1)}%`
  return (
    <li
      className={cn(
        ROW_GRID,
        'cursor-pointer gap-y-0.5 border-b border-border/60 px-2 py-1.5 last:border-b-0 hover:bg-accent/40'
      )}
      data-machine-docker-container={container.id}
      onClick={(event) => {
        // The buttons in the row do their own thing.
        if (!(event.target instanceof Element && event.target.closest('button'))) {
          onOpen()
        }
      }}
    >
      <div className={cn(NAME_CELL, 'flex items-center gap-1.5')}>
        <button
          type="button"
          className="min-w-0 truncate rounded-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          title={container.name}
          aria-label={t(
            'auto.components.machines.containers.open',
            'Details of container {{name}}',
            { name: container.name }
          )}
          onClick={onOpen}
        >
          {container.name}
        </button>
        {gpuIndexes && gpuIndexes.length > 0 ? (
          <MachineProcessTag icon={<Gpu />} whole>
            {t('auto.components.machines.gpu.index', 'GPU {{index}}', {
              index: formatGpuIndexes(gpuIndexes)
            })}
          </MachineProcessTag>
        ) : null}
      </div>
      <span className={cn(CPU_CELL, 'font-mono tabular-nums')}>
        {container.cpuPercent === null ? '—' : `${container.cpuPercent.toFixed(1)}%`}
      </span>
      <span
        className={cn(MEMORY_CELL, 'font-mono whitespace-nowrap tabular-nums')}
        title={
          percent === null
            ? undefined
            : t('auto.components.machines.containers.memoryShare', '{{percent}} of its limit', {
                percent
              })
        }
      >
        {container.memUsageBytes !== null && container.memLimitBytes !== null
          ? formatBytesOfTotal(container.memUsageBytes, container.memLimitBytes)
          : formatBytes(container.memUsageBytes)}
        {percent === null ? null : (
          <span className="ml-1 text-muted-foreground @max-3xl:hidden">{percent}</span>
        )}
      </span>
      <div className={cn(ACTIONS_CELL, 'flex justify-end gap-1')}>
        <MachineDiskRowAction
          label={t('auto.components.machines.docker.restart', 'Restart')}
          onClick={() => onAsk('restart')}
        >
          <RotateCw />
        </MachineDiskRowAction>
        <MachineDiskRowAction
          label={t('auto.components.machines.docker.stop', 'Stop')}
          onClick={() => onAsk('stop')}
        >
          <Square />
        </MachineDiskRowAction>
      </div>
      <div className={SECOND_LINE}>
        <div
          className="min-w-0 flex-1 basis-full truncate font-mono text-2xs text-muted-foreground @lg:basis-0 @3xl:col-span-full @3xl:row-start-2"
          title={container.image}
        >
          {`${container.image} · ${container.status}`}
        </div>
        <span
          className={cn(NET_CELL, SECOND_LINE_FIGURE)}
          title={t(
            'auto.components.machines.containers.netDetail',
            'Received {{received}}, sent {{sent}} since it started',
            {
              received: formatBytes(container.netRxBytes),
              sent: formatBytes(container.netTxBytes)
            }
          )}
        >
          {pair(container.netRxBytes, container.netTxBytes)}
        </span>
        <span
          className={cn(BLOCK_CELL, SECOND_LINE_FIGURE)}
          title={t(
            'auto.components.machines.containers.blockDetail',
            'Read {{read}}, written {{written}} since it started',
            {
              read: formatBytes(container.blockReadBytes),
              written: formatBytes(container.blockWriteBytes)
            }
          )}
        >
          {pair(container.blockReadBytes, container.blockWriteBytes)}
        </span>
        <span className={cn(PIDS_CELL, SECOND_LINE_FIGURE)}>{container.pids ?? '—'}</span>
      </div>
    </li>
  )
}

/**
 * The running containers with what `docker stats` reports, beside the processes of a CPU, memory
 * or GPU detail. Machines without Docker, or with nothing running, show nothing here.
 */
export function MachineDockerContainerStats({
  machine,
  view,
  filter,
  gpuProcesses,
  className
}: {
  machine: MachineSummary
  /** How the view ranks its processes; the containers start ranked the same way. */
  view: MachineProcessSort
  /** The view's process filter, which also finds a container by name, image or id. */
  filter: string
  /** The GPU detail passes what is on the GPUs, and only containers with a process there are listed. */
  gpuProcesses?: readonly MachineGpuProcess[]
  /** For whatever is shown; nothing is, on a machine without Docker or with nothing running. */
  className?: string
}): React.JSX.Element {
  const t = useTranslate()
  const { docker, reload } = useMachineDockerContainers(machine.id)
  const [sort, setSort] = useState<MachineDockerStatsSort>(view === 'cpu' ? 'cpu' : 'memory')
  const [request, setRequest] = useState<MachineDockerContainerRequest | null>(null)
  const [target, setTarget] = useState<MachineDockerDetailTarget | null>(null)
  const onGpus = useMemo(
    () => (gpuProcesses ? gpuIndexesByContainer(gpuProcesses) : undefined),
    [gpuProcesses]
  )
  const containers = docker?.state === 'ready' ? docker.containers : null
  const listed = useMemo(
    () => rankDockerContainers(containers ?? [], { sort, filter: '', onGpus }),
    [containers, sort, onGpus]
  )
  const shown = useMemo(
    () => rankDockerContainers(listed, { sort, filter }),
    [listed, sort, filter]
  )
  const unreachable = useUnreachableText(docker)
  const header = (key: MachineDockerStatsSort, label: string, className: string) => (
    <MachineSortHeader
      label={label}
      active={sort === key}
      className={className}
      onSort={() => setSort(key)}
    />
  )

  return (
    <>
      {unreachable !== null ? (
        <p
          className={cn('text-xs text-muted-foreground [overflow-wrap:anywhere]', className)}
          data-machine-docker-containers="unreachable"
        >
          {unreachable}
        </p>
      ) : listed.length > 0 ? (
        <PageCard
          className={className}
          title={t('auto.components.machines.containers.title', 'Containers')}
          action={
            <span className="truncate text-2xs text-muted-foreground">
              {onGpus
                ? t('auto.components.machines.containers.onGpus', '{{count}} using a GPU', {
                    count: listed.length
                  })
                : t('auto.components.machines.containers.running', '{{count}} running', {
                    count: listed.length
                  })}
            </span>
          }
        >
          <div className="text-xs" data-machine-docker-containers={sort}>
            {shown.length === 0 ? (
              <p className="px-3 py-2.5 text-muted-foreground">
                {t('auto.components.machines.containers.noMatches', 'No container matches.')}
              </p>
            ) : (
              <>
                <div
                  className={cn(
                    ROW_GRID,
                    'gap-y-1 border-b border-border px-2 py-1.5 text-2xs text-muted-foreground'
                  )}
                >
                  <span className={cn(NAME_CELL, 'font-medium')}>
                    {t('auto.components.machines.containers.container', 'Container')}
                  </span>
                  {header('cpu', t('auto.components.machines.processes.cpu', 'CPU'), CPU_CELL)}
                  {header(
                    'memory',
                    t('auto.components.machines.processes.memory', 'Memory'),
                    MEMORY_CELL
                  )}
                  <div className={SECOND_LINE}>
                    {header(
                      'net',
                      t('auto.components.machines.containers.net', 'Net I/O'),
                      NET_CELL
                    )}
                    {header(
                      'block',
                      t('auto.components.machines.containers.block', 'Block I/O'),
                      BLOCK_CELL
                    )}
                    {header(
                      'pids',
                      t('auto.components.machines.containers.pids', 'PIDs'),
                      PIDS_CELL
                    )}
                  </div>
                </div>
                <ul>
                  {shown.map((container) => (
                    <ContainerRow
                      key={container.id}
                      container={container}
                      gpuIndexes={onGpus && gpuIndexesOfContainer(onGpus, container.id)}
                      onOpen={() => setTarget({ kind: 'container', id: container.id })}
                      onAsk={(action) => setRequest({ container, action })}
                    />
                  ))}
                </ul>
              </>
            )}
          </div>
        </PageCard>
      ) : null}
      <MachineDockerContainerDialog
        machine={machine}
        request={request}
        onClose={() => setRequest(null)}
        onDone={reload}
      />
      <MachineDockerDetailSheet
        machine={machine}
        target={target}
        onTarget={setTarget}
        onChanged={reload}
      />
    </>
  )
}
