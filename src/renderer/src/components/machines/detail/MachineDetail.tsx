import React, { useState } from 'react'
import {
  ArrowLeft,
  Bot,
  ArrowLeftRight,
  Code,
  EllipsisVertical,
  Pencil,
  Plug,
  RefreshCw,
  SquareTerminal,
  Trash2
} from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { HostRemoveDialog } from '@/components/sidebar/HostRemoveDialog'
import { resolveHostRemoval } from '@/components/sidebar/host-rename-remove'
import { activateAndRevealWorktree } from '@/lib/workspace/activation/worktree-activation'
import { cn } from '@/lib/class-names'
import type { MachineMetrics } from '../../../../../shared/machines/machine-types'
import type { SshTarget } from '../../../../../shared/ssh-types'
import { MachineFileExplorer } from '../explorer/MachineFileExplorer'
import { MachineWorkSection } from '../work/MachineWorkSection'
import { MachineConnectionBadge } from '../list/MachineConnectionBadge'
import type { MachineAgentSession } from '../model/machine-agent-sessions'
import { refreshMachineMetrics } from '../model/machine-metrics-store'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { MachineEditDialog } from './MachineEditDialog'
import { MachineStatusDot, MachineVitalsStrip, useMachineStatusLabel } from './MachineVitals'
import {
  connectMachine,
  openMachineInEditor,
  openMachineTerminal,
  switchMachineConnection
} from './machine-quick-actions'

function AgentSessionList({
  sessions
}: {
  sessions: readonly MachineAgentSession[]
}): React.JSX.Element {
  const t = useTranslate()
  if (sessions.length === 0) {
    return (
      <p className="text-2xs text-muted-foreground">
        {t('auto.components.machines.detail.noSessions', 'No agents running on this machine.')}
      </p>
    )
  }
  return (
    <ul className="space-y-0.5">
      {sessions.map((session) => (
        <li key={session.paneKey}>
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-accent/50"
            onClick={() => activateAndRevealWorktree(session.worktreeId)}
          >
            <Bot className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 font-medium">
              {session.agentType ?? t('auto.components.machines.detail.agent', 'Agent')}
            </span>
            <span
              className={cn(
                'shrink-0 text-2xs',
                session.state === 'blocked' || session.state === 'waiting'
                  ? 'text-status-warning-text'
                  : 'text-muted-foreground'
              )}
            >
              {session.state}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{session.prompt}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function MachineDetail({
  machine,
  metrics,
  metricsError,
  sessions,
  onBack,
  onChanged
}: {
  machine: MachineSummary
  metrics: MachineMetrics | null
  metricsError: string | null
  sessions: readonly MachineAgentSession[]
  onBack: () => void
  onChanged: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const statusLabel = useMachineStatusLabel()
  const [editing, setEditing] = useState<SshTarget | null>(null)
  const [removing, setRemoving] = useState(false)
  const removal =
    machine.connection === 'local' ? null : resolveHostRemoval(machine.executionHostId)
  const online = machine.status === 'online'
  const homeDir = metrics?.homeDir ?? null
  const canConnect = machine.connection !== 'local' && machine.status !== 'connecting'
  const otherConnection = machine.connection === 'ssh' ? 'server' : 'ssh'
  const canSwitch =
    machine.connection !== 'local' &&
    machine.sshTargetId !== null &&
    machine.runtimeEnvironmentId !== null
  const editSshDetails = async (): Promise<void> => {
    const targets = await window.api.ssh.listTargets()
    setEditing(targets.find((target) => target.id === machine.sshTargetId) ?? null)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-machine-detail={machine.id}>
      <header className="flex shrink-0 items-start gap-2 border-b border-border px-3 py-3 md:px-5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label={t('auto.components.machines.detail.back', 'All machines')}
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{machine.label}</h2>
            <MachineStatusDot status={machine.status} />
            <MachineConnectionBadge connection={machine.connection} />
            <span className="shrink-0 text-2xs text-muted-foreground">
              {statusLabel(machine.status)}
            </span>
          </div>
          {machine.address || machine.statusDetail ? (
            <p
              className={cn(
                'truncate font-mono text-2xs',
                machine.status === 'error' ? 'text-destructive' : 'text-muted-foreground'
              )}
              title={machine.statusDetail ?? machine.address ?? undefined}
            >
              {machine.status === 'error' && machine.statusDetail
                ? machine.statusDetail
                : machine.address}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canConnect && !online ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void connectMachine(machine)}
            >
              <Plug />
              {machine.status === 'error'
                ? t('auto.components.machines.detail.reconnect', 'Reconnect')
                : t('auto.components.machines.detail.connect', 'Connect')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={machine.status === 'connecting'}
            onClick={() => openMachineTerminal(machine)}
          >
            <SquareTerminal />
            <span className="hidden sm:inline">
              {t('auto.components.machines.detail.terminal', 'Terminal')}
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!online || !homeDir}
            onClick={() => homeDir && void openMachineInEditor(machine, homeDir)}
          >
            <Code />
            <span className="hidden sm:inline">
              {t('auto.components.machines.detail.editor', 'Open in editor')}
            </span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('auto.components.machines.detail.more', 'More actions')}
              >
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem
                disabled={!online}
                onSelect={() => void refreshMachineMetrics(machine.id)}
              >
                <RefreshCw />
                {t('auto.components.machines.detail.refreshStats', 'Refresh stats')}
              </DropdownMenuItem>
              {machine.connection !== 'local' && online ? (
                <DropdownMenuItem
                  onSelect={() => void connectMachine({ ...machine, status: 'error' })}
                >
                  <Plug />
                  {t('auto.components.machines.detail.reconnect', 'Reconnect')}
                </DropdownMenuItem>
              ) : null}
              {canSwitch ? (
                <DropdownMenuItem
                  onSelect={() =>
                    void switchMachineConnection(machine, otherConnection).then(onChanged)
                  }
                >
                  <ArrowLeftRight />
                  {otherConnection === 'ssh'
                    ? t('auto.components.machines.detail.useSsh', 'Connect over SSH instead')
                    : t(
                        'auto.components.machines.detail.useServer',
                        'Connect via Seal server instead'
                      )}
                </DropdownMenuItem>
              ) : null}
              {machine.sshTargetId || removal ? <DropdownMenuSeparator /> : null}
              {machine.sshTargetId ? (
                <DropdownMenuItem onSelect={() => void editSshDetails()}>
                  <Pencil />
                  {t('auto.components.machines.detail.editSsh', 'Edit SSH details…')}
                </DropdownMenuItem>
              ) : null}
              {removal ? (
                <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(true)}>
                  <Trash2 />
                  {t('auto.components.machines.detail.remove', 'Remove machine…')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {online ? (
        <section className="shrink-0 space-y-3 border-b border-border px-3 py-3 md:px-5">
          <MachineVitalsStrip metrics={metrics} error={metricsError} />
          <AgentSessionList sessions={sessions} />
          <MachineWorkSection machine={machine} online={online} homeDir={homeDir} />
        </section>
      ) : sessions.length > 0 ? (
        <section className="shrink-0 border-b border-border px-3 py-3 md:px-5">
          <AgentSessionList sessions={sessions} />
        </section>
      ) : null}
      <MachineFileExplorer key={machine.id} machine={machine} />
      <MachineEditDialog target={editing} onClose={() => setEditing(null)} onSaved={onChanged} />
      {removal ? (
        <HostRemoveDialog
          open={removing}
          onOpenChange={(open) => {
            setRemoving(open)
            if (!open) {
              onChanged()
            }
          }}
          hostId={machine.executionHostId}
          label={machine.label}
          target={removal}
        />
      ) : null}
    </div>
  )
}
