import { useTranslate } from '@/i18n/use-translate'
import type { MachineDockerStorageKind } from '../../../../../shared/machines/machine-docker-types'
import type {
  MachineDockerStorageItem,
  MachineDockerStoragePrune
} from './machine-docker-storage-rows'

export type MachineDockerStorageCopy = {
  kind: Record<MachineDockerStorageKind, string>
  /** The badge beside an image, volume or build cache record; a container shows its state. */
  status: (item: MachineDockerStorageItem) => string
  empty: Record<MachineDockerStorageKind, string>
  /** The toggle that leaves only what nothing uses. */
  reclaimableOnly: Record<MachineDockerStorageKind, string>
  prune: Record<MachineDockerStoragePrune, string>
  nothingToPrune: Record<MachineDockerStoragePrune, string>
}

export function useMachineDockerStorageCopy(): MachineDockerStorageCopy {
  const t = useTranslate()
  const unusedOnly = t('auto.components.machines.dockerStorage.unusedOnly', 'Unused only')
  return {
    kind: {
      images: t('auto.components.machines.docker.storage.images', 'Images'),
      containers: t('auto.components.machines.docker.storage.containers', 'Containers'),
      volumes: t('auto.components.machines.docker.storage.volumes', 'Volumes'),
      'build-cache': t('auto.components.machines.docker.storage.buildCache', 'Build cache')
    },
    status: (item) => {
      switch (item.status) {
        case 'in-use':
        case 'running':
          return t('auto.components.machines.dockerStorage.status.inUse', 'In use')
        case 'stopped-only':
          return t(
            'auto.components.machines.dockerStorage.status.stoppedOnly',
            'Used by stopped container'
          )
        case 'dangling':
          return t('auto.components.machines.dockerStorage.status.dangling', 'Dangling')
        case 'shared':
          return t('auto.components.machines.dockerStorage.status.shared', 'Shared')
        case 'unused':
        case 'stopped':
          return t('auto.components.machines.dockerStorage.status.unused', 'Unused')
      }
    },
    empty: {
      images: t('auto.components.machines.dockerStorage.empty.images', 'No images.'),
      containers: t('auto.components.machines.dockerStorage.empty.containers', 'No containers.'),
      volumes: t('auto.components.machines.dockerStorage.empty.volumes', 'No volumes.'),
      'build-cache': t('auto.components.machines.dockerStorage.empty.buildCache', 'No build cache.')
    },
    reclaimableOnly: {
      images: unusedOnly,
      containers: t('auto.components.machines.dockerStorage.stoppedOnly', 'Stopped only'),
      volumes: unusedOnly,
      'build-cache': unusedOnly
    },
    prune: {
      'docker-dangling-images': t(
        'auto.components.machines.dockerStorage.prune.danglingImages',
        'Prune dangling images'
      ),
      'docker-images': t(
        'auto.components.machines.dockerStorage.prune.unusedImages',
        'Remove all unused images'
      ),
      'docker-containers': t(
        'auto.components.machines.dockerStorage.prune.stoppedContainers',
        'Remove stopped containers'
      ),
      'docker-volumes': t(
        'auto.components.machines.dockerStorage.prune.unusedVolumes',
        'Remove unused volumes'
      ),
      'docker-build-cache': t(
        'auto.components.machines.dockerStorage.prune.buildCache',
        'Prune build cache'
      )
    },
    nothingToPrune: {
      'docker-dangling-images': t(
        'auto.components.machines.dockerStorage.nothing.danglingImages',
        'No dangling images to remove.'
      ),
      'docker-images': t(
        'auto.components.machines.dockerStorage.nothing.unusedImages',
        'No unused images to remove.'
      ),
      'docker-containers': t(
        'auto.components.machines.dockerStorage.nothing.stoppedContainers',
        'No stopped containers to remove.'
      ),
      'docker-volumes': t(
        'auto.components.machines.dockerStorage.nothing.unusedVolumes',
        'No unused volumes to remove.'
      ),
      'docker-build-cache': t(
        'auto.components.machines.dockerStorage.nothing.buildCache',
        'No build cache to remove.'
      )
    }
  }
}
