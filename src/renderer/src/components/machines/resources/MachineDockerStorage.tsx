import React, { useCallback, useEffect, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import type {
  MachineDockerStorage,
  MachineDockerStorageKind
} from '../../../../../shared/machines/machine-resource-types'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import { formatBytes } from '../model/machine-format'
import { MachineResourceStat, MachineResourceStats } from './MachineResourceStat'
import { machineResourceApi } from './machine-resource-requests'

/** `docker system df` is slow on a busy daemon, and the figures move slowly. */
const STORAGE_REFRESH_MS = 30_000

/** What Docker holds on a machine's disk; null until it answers or when it cannot. */
export function useMachineDockerStorage(machineId: MachineId): {
  storage: MachineDockerStorage | null
  reload: () => void
} {
  const [storage, setStorage] = useState<MachineDockerStorage | null>(null)
  const reload = useCallback((): void => {
    void machineResourceApi()
      .dockerStorage({ machineId })
      .then(setStorage)
      .catch(() => setStorage(null))
  }, [machineId])
  useEffect(
    () => installWindowVisibilityInterval({ run: reload, intervalMs: STORAGE_REFRESH_MS }),
    [reload]
  )
  return { storage, reload }
}

/** Disk space per kind of Docker object, with what pruning that kind would free. */
export function MachineDockerStorageStats({
  storage
}: {
  storage: MachineDockerStorage | null
}): React.JSX.Element | null {
  const t = useTranslate()
  if (storage?.state !== 'ready' || storage.rows.length === 0) {
    return null
  }
  const labels: Record<MachineDockerStorageKind, string> = {
    images: t('auto.components.machines.docker.storage.images', 'Images'),
    containers: t('auto.components.machines.docker.storage.containers', 'Containers'),
    volumes: t('auto.components.machines.docker.storage.volumes', 'Volumes'),
    'build-cache': t('auto.components.machines.docker.storage.buildCache', 'Build cache')
  }
  return (
    <div className="px-3 py-2.5" data-machine-docker-storage>
      <MachineResourceStats>
        {storage.rows.map((row) => (
          <MachineResourceStat
            key={row.kind}
            label={`${labels[row.kind]} · ${row.count}`}
            value={formatBytes(row.sizeBytes)}
            detail={t(
              'auto.components.machines.docker.storage.reclaimable',
              '{{size}} can be freed',
              {
                size: formatBytes(row.reclaimableBytes)
              }
            )}
          />
        ))}
      </MachineResourceStats>
    </div>
  )
}
