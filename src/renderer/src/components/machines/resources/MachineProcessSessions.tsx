import React from 'react'
import { Bot, PanelsTopLeft } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { MachineProcessSnapshot } from '../../../../../shared/machines/machine-resource-types'
import { formatBytes } from '../model/machine-format'
import { MACHINE_AGENT_NAMES } from './machine-agent-names'

function SessionChip({
  icon,
  label,
  usage,
  active,
  onClick
}: {
  icon: React.ReactNode
  label: string
  usage: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border px-2 py-1 text-2xs hover:bg-accent/60 [&>svg]:size-3 [&>svg]:shrink-0 [&>svg]:text-muted-foreground',
        active && 'bg-accent'
      )}
      onClick={onClick}
    >
      {icon}
      <span className="truncate font-medium">{label}</span>
      <span className="shrink-0 font-mono text-muted-foreground tabular-nums">{usage}</span>
    </button>
  )
}

/** tmux panes and agent sessions with what they are using; picking one filters the process list. */
export function MachineProcessSessions({
  snapshot,
  filter,
  onFilter
}: {
  snapshot: MachineProcessSnapshot
  filter: string
  onFilter: (filter: string) => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const agents = snapshot.processes.filter((process) => process.agent !== null)
  if (snapshot.tmuxPanes.length === 0 && agents.length === 0) {
    return null
  }
  const usage = (cpuPercent: number, rssBytes: number): string =>
    `${cpuPercent.toFixed(1)}% · ${formatBytes(rssBytes)}`
  const pick = (value: string): void => onFilter(filter === value ? '' : value)
  return (
    <div className="space-y-1.5" data-machine-process-sessions>
      <div className="text-3xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('auto.components.machines.processes.sessions', 'Sessions')}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {agents.map((process) => (
          <SessionChip
            key={`agent:${process.pid}`}
            icon={<Bot />}
            label={
              process.tmuxPane
                ? t(
                    'auto.components.machines.processes.agentInPane',
                    '{{agent}} in tmux {{pane}}',
                    {
                      agent: process.agent ? MACHINE_AGENT_NAMES[process.agent] : '',
                      pane: process.tmuxPane
                    }
                  )
                : t('auto.components.machines.processes.agentPid', '{{agent}} · pid {{pid}}', {
                    agent: process.agent ? MACHINE_AGENT_NAMES[process.agent] : '',
                    pid: process.pid
                  })
            }
            usage={usage(process.cpuPercent, process.rssBytes)}
            active={filter === String(process.pid)}
            onClick={() => pick(String(process.pid))}
          />
        ))}
        {snapshot.tmuxPanes.map((pane) => (
          <SessionChip
            key={`pane:${pane.pane}`}
            icon={<PanelsTopLeft />}
            label={t('auto.components.machines.processes.inPane', 'tmux {{pane}}', {
              pane: pane.pane
            })}
            usage={`${usage(pane.cpuPercent, pane.rssBytes)} · ${t(
              'auto.components.machines.processes.paneProcesses',
              '{{count}} proc',
              { count: pane.processCount }
            )}`}
            active={filter === pane.pane}
            onClick={() => pick(pane.pane)}
          />
        ))}
      </div>
    </div>
  )
}
