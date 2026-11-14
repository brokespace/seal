import React from 'react'
import { Bot, PanelsTopLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  MachineProcess,
  MachineProcessSignal
} from '../../../../../shared/machines/machine-resource-types'
import { formatBytes } from '../model/machine-format'
import { MACHINE_AGENT_NAMES } from './machine-agent-names'

export type MachineProcessSort = 'cpu' | 'memory'

const PID_COLUMN = 'w-14 shrink-0 text-right'
const CPU_COLUMN = 'w-14 shrink-0 text-right'
const MEMORY_COLUMN = 'w-16 shrink-0 text-right @lg:w-28'

function Tag({
  icon,
  children
}: {
  icon?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span className="inline-flex max-w-40 min-w-0 items-center gap-1 rounded border border-border px-1 text-3xs leading-4 text-muted-foreground [&>svg]:size-2.5 [&>svg]:shrink-0">
      {icon}
      <span className="truncate">{children}</span>
    </span>
  )
}

function SortHeader({
  label,
  active,
  className,
  onSort
}: {
  label: string
  active: boolean
  className: string
  onSort: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(className, 'font-medium hover:text-foreground', active && 'text-foreground')}
      aria-pressed={active}
      onClick={onSort}
    >
      {label}
      {active ? ' ↓' : ''}
    </button>
  )
}

/** Two lines per process so the command line and the actions stay readable in a narrow pane. */
export function MachineProcessList({
  processes,
  sort,
  onSort,
  onSignal
}: {
  processes: readonly MachineProcess[]
  sort: MachineProcessSort
  onSort: (sort: MachineProcessSort) => void
  onSignal: (process: MachineProcess, signal: MachineProcessSignal) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="text-xs" data-machine-process-list={sort}>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-2 py-1.5 text-2xs text-muted-foreground">
        <span className="min-w-0 flex-1 font-medium">
          {t('auto.components.machines.processes.process', 'Process')}
        </span>
        <span className={cn(PID_COLUMN, 'font-medium')}>
          {t('auto.components.machines.processes.pid', 'PID')}
        </span>
        <SortHeader
          label={t('auto.components.machines.processes.cpu', 'CPU')}
          active={sort === 'cpu'}
          className={CPU_COLUMN}
          onSort={() => onSort('cpu')}
        />
        <SortHeader
          label={t('auto.components.machines.processes.memory', 'Memory')}
          active={sort === 'memory'}
          className={MEMORY_COLUMN}
          onSort={() => onSort('memory')}
        />
      </div>
      <ul>
        {processes.map((process) => (
          <li
            key={`${process.pid}:${process.startMarker}`}
            className="border-b border-border/60 px-2 py-1.5 hover:bg-accent/40"
            data-machine-process={process.pid}
          >
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="truncate font-medium">{process.name}</span>
                {process.agent ? (
                  <Tag icon={<Bot />}>{MACHINE_AGENT_NAMES[process.agent]}</Tag>
                ) : null}
                {process.tmuxPane ? (
                  <Tag icon={<PanelsTopLeft />}>
                    {t('auto.components.machines.processes.inPane', 'tmux {{pane}}', {
                      pane: process.tmuxPane
                    })}
                  </Tag>
                ) : null}
                {process.carriesSealConnection ? (
                  <Tag>
                    {t('auto.components.machines.processes.sealConnection', 'Seal connection')}
                  </Tag>
                ) : null}
              </div>
              <span className={cn(PID_COLUMN, 'font-mono text-muted-foreground tabular-nums')}>
                {process.pid}
              </span>
              <span className={cn(CPU_COLUMN, 'font-mono tabular-nums')}>
                {`${process.cpuPercent.toFixed(1)}%`}
              </span>
              <span className={cn(MEMORY_COLUMN, 'font-mono whitespace-nowrap tabular-nums')}>
                {formatBytes(process.rssBytes)}
                <span className="ml-1 text-muted-foreground @max-lg:hidden">{`${process.memPercent.toFixed(1)}%`}</span>
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <div
                className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground"
                title={process.command}
              >
                <span className="mr-1.5 text-foreground/80">{process.user}</span>
                {process.command}
              </div>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onSignal(process, 'TERM')}
              >
                {t('auto.components.machines.processes.stop', 'Stop')}
              </Button>
              <Button
                type="button"
                variant="destructive-chip"
                size="xs"
                onClick={() => onSignal(process, 'KILL')}
              >
                {t('auto.components.machines.processes.kill', 'Force kill')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
