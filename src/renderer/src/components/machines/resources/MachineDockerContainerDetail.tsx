import React, { useCallback, useState } from 'react'
import { ArrowRight, Loader2, Play, RotateCw, Square, Trash2 } from 'lucide-react'
import { PageSection } from '@/components/page-layout/PageCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import type {
  MachineDockerContainerDetails,
  MachineDockerContainerMount,
  MachineDockerDetailTarget
} from '../../../../../shared/machines/machine-docker-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { formatBytes } from '../model/machine-format'
import {
  MachineDockerContainerDialog,
  useMachineDockerContainerStart,
  type MachineDockerConfirmedAction,
  type MachineDockerContainerRequest
} from './MachineDockerContainerDialog'
import { MachineDockerContainerLogs } from './MachineDockerContainerLogs'
import { MachineDockerStateBadge } from './MachineDockerContainerRefs'
import {
  MachineDockerCopyButton,
  MachineDockerFact,
  MachineDockerFacts,
  MachineDockerLink,
  MachineDockerTime
} from './MachineDockerDetailFacts'
import { MachineResourceStat, MachineResourceStats } from './MachineResourceStat'
import { useMachineDockerContainers } from './use-machine-docker-containers'

function HealthBadge({ health }: { health: string }): React.JSX.Element {
  const t = useTranslate()
  return (
    <Badge
      variant={health === 'unhealthy' ? 'destructive' : 'outline'}
      data-machine-docker-health={health}
    >
      {health === 'healthy'
        ? t('auto.components.machines.dockerDetails.health.healthy', 'Healthy')
        : health === 'unhealthy'
          ? t('auto.components.machines.dockerDetails.health.unhealthy', 'Unhealthy')
          : health === 'starting'
            ? t('auto.components.machines.dockerDetails.health.starting', 'Health check starting')
            : health}
    </Badge>
  )
}

function Mount({
  mount,
  onTarget
}: {
  mount: MachineDockerContainerMount
  onTarget: (target: MachineDockerDetailTarget) => void
}): React.JSX.Element {
  const t = useTranslate()
  const { volume } = mount
  return (
    <li className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 font-mono">
      {volume ? (
        <MachineDockerLink onOpen={() => onTarget({ kind: 'volume', id: volume })}>
          {volume}
        </MachineDockerLink>
      ) : (
        <span>{mount.source || mount.type}</span>
      )}
      <ArrowRight className="size-3 shrink-0 self-center text-muted-foreground" />
      <span>{mount.destination}</span>
      {mount.readOnly ? (
        <Badge variant="referenceLabel">
          {t('auto.components.machines.dockerDetails.readOnly', 'ro')}
        </Badge>
      ) : null}
    </li>
  )
}

function pair(first: number | null | undefined, second: number | null | undefined): string {
  return first == null && second == null ? '—' : `${formatBytes(first)} / ${formatBytes(second)}`
}

/** One container: its state, what it is using now, how it was set up, and its log. */
export function MachineDockerContainerDetail({
  machine,
  details,
  revision,
  onTarget,
  onReload,
  onChanged,
  onRemoved
}: {
  machine: MachineSummary
  details: MachineDockerContainerDetails
  /** Changes whenever the details were asked for again. */
  revision: number
  onTarget: (target: MachineDockerDetailTarget) => void
  onReload: () => void
  onChanged: () => void
  onRemoved: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [request, setRequest] = useState<MachineDockerContainerRequest | null>(null)
  const ask = (action: MachineDockerConfirmedAction): void =>
    setRequest({ container: details, action })
  const { docker, reload: reloadStats } = useMachineDockerContainers(machine.id, details.running)
  const stats =
    docker?.state === 'ready'
      ? docker.containers.find((container) => container.id === details.id)
      : undefined
  const acted = useCallback(() => {
    onReload()
    reloadStats()
    onChanged()
  }, [onReload, reloadStats, onChanged])
  const { starting, start } = useMachineDockerContainerStart(machine.id, acted)
  const isStarting = starting.has(details.id)

  return (
    <div className="space-y-5" data-machine-docker-container-detail={details.id}>
      <PageSection label={t('auto.components.machines.dockerDetails.status', 'Status')}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <div className="flex items-center gap-1.5">
            <MachineDockerStateBadge state={details.state} exitCode={details.exitCode} />
            {details.health ? <HealthBadge health={details.health} /> : null}
          </div>
          <div className="ml-auto flex flex-wrap justify-end gap-1.5">
            {details.running ? (
              <>
                <Button type="button" variant="outline" size="xs" onClick={() => ask('restart')}>
                  <RotateCw />
                  {t('auto.components.machines.docker.restart', 'Restart')}
                </Button>
                <Button type="button" variant="outline" size="xs" onClick={() => ask('stop')}>
                  <Square />
                  {t('auto.components.machines.docker.stop', 'Stop')}
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* A disabled button takes no pointer events, so the span carries the tooltip. */}
                    <span tabIndex={0} className="inline-flex rounded-md">
                      <Button type="button" variant="destructive-chip" size="xs" disabled>
                        <Trash2 />
                        {t('auto.components.machines.docker.remove', 'Remove')}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('auto.components.machines.dockerDetails.stopFirst', 'Stop it first')}
                  </TooltipContent>
                </Tooltip>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={isStarting}
                  onClick={() => void start(details)}
                >
                  {isStarting ? <Loader2 className="animate-spin" /> : <Play />}
                  {t('auto.components.machines.docker.start', 'Start')}
                </Button>
                <Button
                  type="button"
                  variant="destructive-chip"
                  size="xs"
                  onClick={() => ask('remove')}
                >
                  <Trash2 />
                  {t('auto.components.machines.docker.remove', 'Remove')}
                </Button>
              </>
            )}
          </div>
        </div>
        <MachineDockerFacts>
          <MachineDockerFact label={t('auto.components.machines.dockerDetails.started', 'Started')}>
            <MachineDockerTime at={details.startedAt} />
          </MachineDockerFact>
          {details.running || details.finishedAt === null ? null : (
            <MachineDockerFact
              label={t('auto.components.machines.dockerDetails.finished', 'Finished')}
            >
              <MachineDockerTime at={details.finishedAt} />
            </MachineDockerFact>
          )}
          <MachineDockerFact
            label={t('auto.components.machines.dockerDetails.restarts', 'Restarts')}
          >
            {details.restartCount}
          </MachineDockerFact>
          <MachineDockerFact
            label={t('auto.components.machines.dockerDetails.restartPolicy', 'Restart policy')}
            mono
          >
            {details.restartPolicy ?? '—'}
          </MachineDockerFact>
          {details.oomKilled ? (
            <MachineDockerFact label={t('auto.components.machines.dockerDetails.memory', 'Memory')}>
              <span className="text-destructive">
                {t(
                  'auto.components.machines.dockerDetails.oomKilled',
                  'Killed for using more memory than its limit'
                )}
              </span>
            </MachineDockerFact>
          ) : null}
          {details.error ? (
            <MachineDockerFact label={t('auto.components.machines.dockerDetails.error', 'Error')}>
              <span className="text-destructive">{details.error}</span>
            </MachineDockerFact>
          ) : null}
        </MachineDockerFacts>
      </PageSection>

      {details.running ? (
        <PageSection label={t('auto.components.machines.dockerDetails.usage', 'Usage now')}>
          <MachineResourceStats columns={5}>
            <MachineResourceStat
              label={t('auto.components.machines.processes.cpu', 'CPU')}
              value={stats?.cpuPercent == null ? '—' : `${stats.cpuPercent.toFixed(1)}%`}
              detail={t('auto.components.machines.dockerDetails.ofOneCore', 'of one core')}
            />
            <MachineResourceStat
              label={t('auto.components.machines.processes.memory', 'Memory')}
              value={formatBytes(stats?.memUsageBytes)}
              detail={
                stats?.memLimitBytes == null
                  ? undefined
                  : stats.memPercent === null
                    ? t('auto.components.machines.memory.ofTotal', 'of {{total}}', {
                        total: formatBytes(stats.memLimitBytes)
                      })
                    : t(
                        'auto.components.machines.dockerDetails.ofLimit',
                        'of {{total}} · {{percent}}%',
                        {
                          total: formatBytes(stats.memLimitBytes),
                          percent: stats.memPercent.toFixed(1)
                        }
                      )
              }
            />
            <MachineResourceStat
              label={t('auto.components.machines.containers.net', 'Net I/O')}
              value={pair(stats?.netRxBytes, stats?.netTxBytes)}
              detail={t('auto.components.machines.dockerDetails.netDetail', 'received / sent')}
            />
            <MachineResourceStat
              label={t('auto.components.machines.containers.block', 'Block I/O')}
              value={pair(stats?.blockReadBytes, stats?.blockWriteBytes)}
              detail={t('auto.components.machines.dockerDetails.blockDetail', 'read / written')}
            />
            <MachineResourceStat
              label={t('auto.components.machines.containers.pids', 'PIDs')}
              value={stats?.pids == null ? '—' : String(stats.pids)}
            />
          </MachineResourceStats>
        </PageSection>
      ) : null}

      <PageSection label={t('auto.components.machines.dockerDetails.setup', 'Setup')}>
        <MachineDockerFacts>
          <MachineDockerFact label={t('auto.components.machines.dockerDetails.image', 'Image')}>
            <MachineDockerLink
              mono
              onOpen={() => onTarget({ kind: 'image', id: details.imageId ?? details.image })}
            >
              {details.image}
            </MachineDockerLink>
          </MachineDockerFact>
          <MachineDockerFact label={t('auto.components.machines.dockerDetails.id', 'ID')} mono>
            <span title={details.id}>{details.id.slice(0, 12)}</span>
            <MachineDockerCopyButton
              text={details.id}
              label={t('auto.components.machines.dockerDetails.copyId', 'Copy the full ID')}
            />
          </MachineDockerFact>
          <MachineDockerFact
            label={t('auto.components.machines.dockerDetails.command', 'Command')}
            mono
          >
            {details.command || '—'}
          </MachineDockerFact>
          <MachineDockerFact label={t('auto.components.machines.dockerDetails.created', 'Created')}>
            <MachineDockerTime at={details.createdAt} />
          </MachineDockerFact>
          <MachineDockerFact
            label={t('auto.components.machines.dockerDetails.ports', 'Ports')}
            mono={details.ports.length > 0}
          >
            {details.ports.length > 0 ? (
              <ul>
                {details.ports.map((port) => (
                  <li key={port}>{port}</li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">
                {t('auto.components.machines.dockerDetails.noPorts', 'None published')}
              </span>
            )}
          </MachineDockerFact>
          <MachineDockerFact
            label={t('auto.components.machines.dockerDetails.networks', 'Networks')}
            mono
          >
            {details.networks.join(', ') || '—'}
          </MachineDockerFact>
          <MachineDockerFact label={t('auto.components.machines.dockerDetails.mounts', 'Mounts')}>
            {details.mounts.length > 0 ? (
              <ul className="space-y-0.5">
                {details.mounts.map((mount) => (
                  <Mount key={mount.destination} mount={mount} onTarget={onTarget} />
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">
                {t('auto.components.machines.dockerDetails.noMounts', 'None')}
              </span>
            )}
          </MachineDockerFact>
        </MachineDockerFacts>
      </PageSection>

      <PageSection label={t('auto.components.machines.dockerDetails.logs.title', 'Logs')}>
        <MachineDockerContainerLogs
          machineId={machine.id}
          containerId={details.id}
          running={details.running}
          revision={revision}
        />
      </PageSection>

      <MachineDockerContainerDialog
        machine={machine}
        request={request}
        onClose={() => setRequest(null)}
        onDone={() => {
          if (request?.action === 'remove') {
            onChanged()
            onRemoved()
          } else {
            acted()
          }
        }}
      />
    </div>
  )
}
