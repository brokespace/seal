import React, { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageCard } from '@/components/page-layout/PageCard'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import {
  MACHINE_DOCKER_PRUNE_TARGETS,
  type MachineDockerContainer,
  type MachineDockerContainers
} from '../../../../../shared/machines/machine-resource-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { formatBytes } from '../model/machine-format'
import { refreshMachineMetrics } from '../model/machine-metrics-store'
import { MachineCleanupSection } from './MachineCleanupSection'
import {
  MachineDockerContainerDialog,
  type MachineDockerConfirmedAction,
  type MachineDockerContainerRequest
} from './MachineDockerContainerDialog'
import { MachineDockerStorageStats, useMachineDockerStorage } from './MachineDockerStorage'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'

const DOCKER_REFRESH_MS = 5_000

function ContainerRow({
  container,
  starting,
  onStart,
  onAsk
}: {
  container: MachineDockerContainer
  starting: boolean
  onStart: () => void
  onAsk: (action: MachineDockerConfirmedAction) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <li
      className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 px-3 py-1.5 text-xs"
      data-machine-docker-container={container.running ? 'running' : 'stopped'}
    >
      <div className="min-w-40 flex-1">
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
      <div className="flex shrink-0 gap-1 whitespace-nowrap">
        {container.running ? (
          <>
            <Button type="button" variant="outline" size="xs" onClick={() => onAsk('restart')}>
              {t('auto.components.machines.docker.restart', 'Restart')}
            </Button>
            <Button
              type="button"
              variant="destructive-chip"
              size="xs"
              onClick={() => onAsk('stop')}
            >
              {t('auto.components.machines.docker.stop', 'Stop')}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" size="xs" disabled={starting} onClick={onStart}>
              {starting ? <Loader2 className="animate-spin" /> : null}
              {t('auto.components.machines.docker.start', 'Start')}
            </Button>
            <Button
              type="button"
              variant="destructive-chip"
              size="xs"
              onClick={() => onAsk('remove')}
            >
              {t('auto.components.machines.docker.remove', 'Remove')}
            </Button>
          </>
        )}
      </div>
    </li>
  )
}

/** A machine's Docker containers with what they hold, and what can be done about them. */
export function MachineDockerSection({
  machine
}: {
  machine: MachineSummary
}): React.JSX.Element | null {
  const t = useTranslate()
  const [docker, setDocker] = useState<MachineDockerContainers | null>(null)
  const [request, setRequest] = useState<MachineDockerContainerRequest | null>(null)
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set())
  const machineId = machine.id
  const { storage, reload: reloadStorage } = useMachineDockerStorage(machineId)

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

  const start = async (container: MachineDockerContainer): Promise<void> => {
    setStarting((previous) => new Set(previous).add(container.id))
    try {
      await machineResourceApi().dockerContainerAction({
        machineId,
        containerId: container.id,
        action: 'start'
      })
      toast.success(
        t('auto.components.machines.docker.started', 'Started {{name}}.', { name: container.name })
      )
    } catch (err) {
      toast.error(resourceErrorText(err))
    }
    await load()
    setStarting((previous) => {
      const next = new Set(previous)
      next.delete(container.id)
      return next
    })
  }

  if (docker === null || docker.state === 'missing') {
    return null
  }
  return (
    <div className="space-y-(--page-section-gap)" data-machine-docker={docker.state}>
      <PageCard title={t('auto.components.machines.docker.title', 'Docker containers')}>
        {docker.state === 'unreachable' ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {docker.message}
          </p>
        ) : docker.containers.length === 0 ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">
            {t('auto.components.machines.docker.none', 'No containers on this machine.')}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {docker.containers.map((container) => (
              <ContainerRow
                key={container.id}
                container={container}
                starting={starting.has(container.id)}
                onStart={() => void start(container)}
                onAsk={(action) => setRequest({ container, action })}
              />
            ))}
          </ul>
        )}
      </PageCard>
      {docker.state === 'ready' ? (
        <PageCard title={t('auto.components.machines.docker.pruneTitle', 'Free up Docker space')}>
          <MachineDockerStorageStats storage={storage} />
          <div className="border-t border-border">
            <MachineCleanupSection
              machine={machine}
              targets={MACHINE_DOCKER_PRUNE_TARGETS}
              onCleaned={() => {
                void load()
                reloadStorage()
                void refreshMachineMetrics(machineId)
              }}
            />
          </div>
        </PageCard>
      ) : null}
      <MachineDockerContainerDialog
        machine={machine}
        request={request}
        onClose={() => setRequest(null)}
        onDone={() => {
          void load()
          reloadStorage()
        }}
      />
    </div>
  )
}
