import React from 'react'
import { RefreshCw } from 'lucide-react'
import { PageCard } from '@/components/page-layout/PageCard'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  MachineDockerStorage,
  MachineDockerStorageKind
} from '../../../../../shared/machines/machine-docker-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import {
  MachineDockerStorageStats,
  MachineDockerStorageStatsSkeleton,
  type MachineDockerStorageState
} from './MachineDockerStorage'
import { useMachineDockerUnavailableCopy } from './MachineDockerStorageUnavailable'

function MachineDockerStorageNote({
  machine,
  storage
}: {
  machine: MachineSummary
  storage: Exclude<MachineDockerStorage, { state: 'ready' }>
}): React.JSX.Element {
  const copy = useMachineDockerUnavailableCopy(machine, storage)
  return (
    <p
      className="px-3 py-2.5 text-xs text-muted-foreground"
      data-machine-docker-unavailable={copy.reason}
    >
      {copy.title}
    </p>
  )
}

/** The Docker figures on the Disk panel; the card holds its place while the first read runs. */
export function MachineDockerStorageCard({
  machine,
  docker,
  onManage,
  onPick
}: {
  machine: MachineSummary
  docker: MachineDockerStorageState
  onManage: () => void
  onPick: (kind: MachineDockerStorageKind) => void
}): React.JSX.Element {
  const t = useTranslate()
  const storage = docker.storage
  return (
    <PageCard
      title={t('auto.components.machines.disk.dockerStorage', 'Docker storage')}
      action={
        <div className="-mr-1.5 flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('auto.components.machines.disk.dockerRefresh', 'Refresh Docker storage')}
            aria-busy={docker.loading}
            onClick={() => void docker.reload({ force: true })}
            data-machine-docker-card-refresh
          >
            <RefreshCw
              className={cn(docker.loading && 'animate-spin motion-reduce:animate-none')}
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onManage}
            data-machine-docker-manage
          >
            {t('auto.components.machines.disk.dockerManage', 'Manage')}
          </Button>
        </div>
      }
    >
      {storage === null ? (
        <MachineDockerStorageStatsSkeleton inset />
      ) : storage.state !== 'ready' ? (
        <MachineDockerStorageNote machine={machine} storage={storage} />
      ) : storage.rows.length === 0 ? (
        <p className="px-3 py-2.5 text-xs text-muted-foreground">
          {t(
            'auto.components.machines.disk.dockerEmpty',
            'Docker is not holding any images, containers, volumes or build cache.'
          )}
        </p>
      ) : (
        <MachineDockerStorageStats storage={storage} onPick={onPick} />
      )}
    </PageCard>
  )
}
