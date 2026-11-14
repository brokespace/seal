import React, { useState } from 'react'
import {
  ArrowLeft,
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
import { cn } from '@/lib/class-names'
import type { MachineMetrics } from '../../../../../shared/machines/machine-types'
import type { SshTarget } from '../../../../../shared/ssh-types'
import { MachineFileExplorer, type MachineFolderRequest } from '../explorer/MachineFileExplorer'
import { MachineResourcePanel } from '../resources/MachineResourcePanel'
import type { MachineResourceKind } from '../resources/machine-resource-requests'
import { MachineConnectionBadge } from '../list/MachineConnectionBadge'
import { refreshMachineMetrics } from '../model/machine-metrics-store'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { MachineEditDialog } from './MachineEditDialog'
import { MachineSessionList } from './MachineSessionList'
import { MachineStatusDot, MachineVitalsStrip, useMachineStatusLabel } from './MachineVitals'
import {
  connectMachine,
  openMachineInEditor,
  openMachineTerminal,
  switchMachineConnection
} from './machine-quick-actions'

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
  sessions: readonly LiveSession[]
  onBack: () => void
  onChanged: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const statusLabel = useMachineStatusLabel()
  const [editing, setEditing] = useState<SshTarget | null>(null)
  const [removing, setRemoving] = useState(false)
  const [opened, setOpened] = useState<{ machineId: string; kind: MachineResourceKind } | null>(
    null
  )
  const [folderRequest, setFolderRequest] = useState<MachineFolderRequest | null>(null)
  const removal =
    machine.connection === 'local' ? null : resolveHostRemoval(machine.executionHostId)
  const online = machine.status === 'online'
  const homeDir = metrics?.homeDir ?? null
  // A detail belongs to the machine it was opened on, and needs that machine reachable.
  const resource = online && opened?.machineId === machine.id ? opened.kind : null
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
          <MachineVitalsStrip
            metrics={metrics}
            error={metricsError}
            selected={resource}
            onSelect={(kind) =>
              setOpened(resource === kind ? null : { machineId: machine.id, kind })
            }
          />
          <MachineSessionList sessions={sessions} />
        </section>
      ) : sessions.length > 0 ? (
        <section className="shrink-0 border-b border-border px-3 py-3 md:px-5">
          <MachineSessionList sessions={sessions} />
        </section>
      ) : null}
      {resource ? (
        <MachineResourcePanel
          key={`${machine.id}:${resource}`}
          machine={machine}
          metrics={metrics}
          kind={resource}
          onClose={() => setOpened(null)}
          onReveal={(path) => {
            setFolderRequest((previous) => ({ path, id: (previous?.id ?? 0) + 1 }))
            setOpened(null)
          }}
        />
      ) : null}
      <MachineFileExplorer
        key={machine.id}
        machine={machine}
        homeDir={homeDir}
        hidden={resource !== null}
        folderRequest={folderRequest}
      />
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
