import React, { useState } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type {
  MachineProcess,
  MachineProcessSignal
} from '../../../../../shared/machines/machine-resource-types'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import { MACHINE_AGENT_NAMES } from './machine-agent-names'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'

export type MachineProcessSignalRequest = { process: MachineProcess; signal: MachineProcessSignal }

function Warning({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="flex items-start gap-1.5 text-xs text-status-warning-text">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** Nothing is signalled until this is confirmed; main re-checks the process is still the one shown. */
export function MachineProcessSignalDialog({
  machineId,
  machineLabel,
  request,
  onClose,
  onSignalled
}: {
  machineId: MachineId
  machineLabel: string
  request: MachineProcessSignalRequest | null
  onClose: () => void
  onSignalled: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seededFor, setSeededFor] = useState<MachineProcessSignalRequest | null>(null)
  if (seededFor !== request) {
    setSeededFor(request)
    setBusy(false)
    setError(null)
  }
  const process = request?.process ?? null
  const force = request?.signal === 'KILL'
  const names = { name: process?.name ?? '', pid: process?.pid ?? 0, machine: machineLabel }

  const confirm = async (): Promise<void> => {
    if (!request || busy) {
      return
    }
    setBusy(true)
    try {
      const result = await machineResourceApi().signalProcess({
        machineId,
        pid: request.process.pid,
        signal: request.signal,
        startMarker: request.process.startMarker
      })
      onSignalled()
      if (result.outcome === 'sent') {
        toast.success(
          force
            ? t(
                'auto.components.machines.processes.killed',
                'Force killed {{name}} ({{pid}}).',
                names
              )
            : t(
                'auto.components.machines.processes.stopped',
                'Asked {{name}} ({{pid}}) to stop.',
                names
              )
        )
        onClose()
      } else if (result.outcome === 'gone') {
        toast.message(
          t(
            'auto.components.machines.processes.gone',
            '{{name}} ({{pid}}) had already exited.',
            names
          )
        )
        onClose()
      } else {
        setError(
          result.outcome === 'replaced'
            ? t(
                'auto.components.machines.processes.replaced',
                'Process {{pid}} is no longer {{name}}: its id now belongs to another process, so nothing was signalled.',
                names
              )
            : result.message
        )
        setBusy(false)
      }
    } catch (err) {
      setError(resourceErrorText(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-machine-signal-dialog={request?.signal}>
        <DialogHeader>
          <DialogTitle>
            {force
              ? t('auto.components.machines.processes.killTitle', 'Force kill {{name}}?', names)
              : t('auto.components.machines.processes.stopTitle', 'Stop {{name}}?', names)}
          </DialogTitle>
          <DialogDescription>
            {force
              ? t(
                  'auto.components.machines.processes.killDescription',
                  'Sends SIGKILL to process {{pid}} on {{machine}}. It ends immediately, with no chance to save or clean up.',
                  names
                )
              : t(
                  'auto.components.machines.processes.stopDescription',
                  'Sends SIGTERM to process {{pid}} on {{machine}}, asking it to exit. Anything it has not saved is lost.',
                  names
                )}
          </DialogDescription>
        </DialogHeader>
        {process ? (
          <div className="space-y-2">
            <p className="max-h-24 scrollbar-sleek overflow-y-auto rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-2xs [overflow-wrap:anywhere]">
              {process.command}
            </p>
            <p className="text-2xs text-muted-foreground">
              {t('auto.components.machines.processes.owner', 'Run by {{user}}', {
                user: process.user
              })}
              {process.tmuxPane
                ? ` · ${t('auto.components.machines.processes.inPane', 'tmux {{pane}}', { pane: process.tmuxPane })}`
                : ''}
            </p>
            {process.carriesSealConnection ? (
              <Warning>
                {t(
                  'auto.components.machines.processes.connectionWarning',
                  'Seal reaches this machine through this process. Stopping it disconnects Seal from the machine.'
                )}
              </Warning>
            ) : null}
            {process.agent ? (
              <Warning>
                {t(
                  'auto.components.machines.processes.agentWarning',
                  'This is a running {{agent}} session. Stopping it ends the work the agent is doing.',
                  { agent: MACHINE_AGENT_NAMES[process.agent] }
                )}
              </Warning>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('auto.components.machines.processes.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {force
              ? t('auto.components.machines.processes.killConfirm', 'Force kill')
              : t('auto.components.machines.processes.stopConfirm', 'Stop process')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
