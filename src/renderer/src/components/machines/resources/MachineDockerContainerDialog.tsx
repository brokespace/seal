import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
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
  MachineDockerContainer,
  MachineDockerContainerAction
} from '../../../../../shared/machines/machine-resource-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'

/** Starting a container interrupts nothing, so only these three ask first. */
export type MachineDockerConfirmedAction = Exclude<MachineDockerContainerAction, 'start'>

export type MachineDockerContainerRequest = {
  container: MachineDockerContainer
  action: MachineDockerConfirmedAction
}

type ActionCopy = { title: string; description: string; confirm: string; done: string }

function useActionCopy(
  action: MachineDockerConfirmedAction | undefined,
  names: { name: string; machine: string }
): ActionCopy {
  const t = useTranslate()
  switch (action) {
    case 'restart':
      return {
        title: t(
          'auto.components.machines.docker.restartTitle',
          'Restart container {{name}}?',
          names
        ),
        description: t(
          'auto.components.machines.docker.restartDescription',
          'Runs docker restart on {{machine}}. The container goes down for a moment and whatever it serves is interrupted.',
          names
        ),
        confirm: t('auto.components.machines.docker.restartConfirm', 'Restart container'),
        done: t('auto.components.machines.docker.restarted', 'Restarted {{name}}.', names)
      }
    case 'remove':
      return {
        title: t(
          'auto.components.machines.docker.removeTitle',
          'Remove container {{name}}?',
          names
        ),
        description: t(
          'auto.components.machines.docker.removeDescription',
          'Runs docker rm on {{machine}}. The container and every file written inside it are deleted for good. Its image and named volumes stay.',
          names
        ),
        confirm: t('auto.components.machines.docker.removeConfirm', 'Remove container'),
        done: t('auto.components.machines.docker.removed', 'Removed {{name}}.', names)
      }
    case 'stop':
    case undefined:
      return {
        title: t('auto.components.machines.docker.stopTitle', 'Stop container {{name}}?', names),
        description: t(
          'auto.components.machines.docker.stopDescription',
          'Runs docker stop on {{machine}}. The container stays stopped, along with whatever it serves, until it is started again.',
          names
        ),
        confirm: t('auto.components.machines.docker.stopConfirm', 'Stop container'),
        done: t('auto.components.machines.docker.stopped', 'Stopped {{name}}.', names)
      }
  }
}

/** Says what a container action does on which machine, and runs it only once confirmed. */
export function MachineDockerContainerDialog({
  machine,
  request,
  onClose,
  onDone
}: {
  machine: MachineSummary
  request: MachineDockerContainerRequest | null
  onClose: () => void
  onDone: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seededFor, setSeededFor] = useState<MachineDockerContainerRequest | null>(null)
  if (seededFor !== request) {
    setSeededFor(request)
    setBusy(false)
    setError(null)
  }
  const copy = useActionCopy(request?.action, {
    name: request?.container.name ?? '',
    machine: machine.label
  })
  const confirm = async (): Promise<void> => {
    if (!request || busy) {
      return
    }
    setBusy(true)
    try {
      await machineResourceApi().dockerContainerAction({
        machineId: machine.id,
        containerId: request.container.id,
        action: request.action
      })
      toast.success(copy.done)
      onDone()
      onClose()
    } catch (err) {
      setError(resourceErrorText(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-machine-docker-dialog={request?.action}>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {request ? (
          <p className="font-mono text-2xs text-muted-foreground [overflow-wrap:anywhere]">
            {`${request.container.image} · ${request.container.id}`}
          </p>
        ) : null}
        {error ? (
          <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('auto.components.machines.docker.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            variant={request?.action === 'restart' ? 'default' : 'destructive'}
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
