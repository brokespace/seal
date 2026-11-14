import React, { useCallback, useEffect, useState } from 'react'
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
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import type {
  MachineDockerContainer,
  MachineDockerContainerAction,
  MachineDockerContainers
} from '../../../../../shared/machines/machine-resource-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { formatBytes } from '../model/machine-format'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'

const DOCKER_REFRESH_MS = 10_000

type ContainerRequest = { container: MachineDockerContainer; action: MachineDockerContainerAction }

function ContainerActionDialog({
  machine,
  request,
  onClose,
  onDone
}: {
  machine: MachineSummary
  request: ContainerRequest | null
  onClose: () => void
  onDone: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seededFor, setSeededFor] = useState<ContainerRequest | null>(null)
  if (seededFor !== request) {
    setSeededFor(request)
    setBusy(false)
    setError(null)
  }
  const restart = request?.action === 'restart'
  const names = { name: request?.container.name ?? '', machine: machine.label }
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
      toast.success(
        restart
          ? t('auto.components.machines.docker.restarted', 'Restarted {{name}}.', names)
          : t('auto.components.machines.docker.stopped', 'Stopped {{name}}.', names)
      )
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
          <DialogTitle>
            {restart
              ? t(
                  'auto.components.machines.docker.restartTitle',
                  'Restart container {{name}}?',
                  names
                )
              : t('auto.components.machines.docker.stopTitle', 'Stop container {{name}}?', names)}
          </DialogTitle>
          <DialogDescription>
            {restart
              ? t(
                  'auto.components.machines.docker.restartDescription',
                  'Runs docker restart on {{machine}}. The container goes down for a moment and whatever it serves is interrupted.',
                  names
                )
              : t(
                  'auto.components.machines.docker.stopDescription',
                  'Runs docker stop on {{machine}}. The container stays stopped, along with whatever it serves, until it is started again.',
                  names
                )}
          </DialogDescription>
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
            variant={restart ? 'default' : 'destructive'}
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {restart
              ? t('auto.components.machines.docker.restartConfirm', 'Restart container')
              : t('auto.components.machines.docker.stopConfirm', 'Stop container')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Memory held by Docker containers; absent when the machine has no Docker. */
export function MachineDockerSection({
  machine
}: {
  machine: MachineSummary
}): React.JSX.Element | null {
  const t = useTranslate()
  const [docker, setDocker] = useState<MachineDockerContainers | null>(null)
  const [request, setRequest] = useState<ContainerRequest | null>(null)
  const machineId = machine.id

  const load = useCallback(async (): Promise<void> => {
    try {
      setDocker(await machineResourceApi().listDockerContainers({ machineId }))
    } catch (err) {
      setDocker({ state: 'unreachable', message: resourceErrorText(err) })
    }
  }, [machineId])

  useEffect(
    () =>
      installWindowVisibilityInterval({ run: () => void load(), intervalMs: DOCKER_REFRESH_MS }),
    [load]
  )

  if (docker === null || docker.state === 'missing') {
    return null
  }
  return (
    <section className="space-y-1.5" data-machine-docker={docker.state}>
      <h3 className="text-3xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('auto.components.machines.docker.title', 'Docker containers')}
      </h3>
      {docker.state === 'unreachable' ? (
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{docker.message}</p>
      ) : docker.containers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('auto.components.machines.docker.none', 'No containers on this machine.')}
        </p>
      ) : (
        <ul className="divide-y divide-border/60 border-y border-border/60">
          {docker.containers.map((container) => (
            <li key={container.id} className="flex items-center gap-3 px-2 py-1.5 text-xs">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{container.name}</div>
                <div className="truncate font-mono text-2xs text-muted-foreground">
                  {`${container.image} · ${container.status}`}
                </div>
              </div>
              <div className="shrink-0 text-right font-mono whitespace-nowrap tabular-nums">
                {container.memUsageBytes === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <>
                    {formatBytes(container.memUsageBytes)}
                    <span className="ml-1 text-muted-foreground">
                      {container.memPercent === null ? '' : `${container.memPercent.toFixed(1)}%`}
                    </span>
                  </>
                )}
              </div>
              {container.running ? (
                <div className="shrink-0 whitespace-nowrap">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setRequest({ container, action: 'restart' })}
                  >
                    {t('auto.components.machines.docker.restart', 'Restart')}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive-chip"
                    size="xs"
                    className="ml-1"
                    onClick={() => setRequest({ container, action: 'stop' })}
                  >
                    {t('auto.components.machines.docker.stop', 'Stop')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ContainerActionDialog
        machine={machine}
        request={request}
        onClose={() => setRequest(null)}
        onDone={() => void load()}
      />
    </section>
  )
}
