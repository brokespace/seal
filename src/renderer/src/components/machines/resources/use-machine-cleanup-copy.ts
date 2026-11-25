import { useTranslate } from '@/i18n/use-translate'
import type { MachineDockerStorageKind } from '../../../../../shared/machines/machine-docker-types'
import type { MachineCleanupTargetId } from '../../../../../shared/machines/machine-resource-types'

export type MachineCleanupCopy = {
  title: string
  /** What the row lists. */
  description: string
  /** What confirming does, shown in the confirmation. */
  removal: string
}

export function useMachineCleanupCopy(): Record<MachineCleanupTargetId, MachineCleanupCopy> {
  const t = useTranslate()
  return {
    'docker-images': {
      title: t('auto.components.machines.cleanup.dockerImages.title', 'Unused Docker images'),
      description: t(
        'auto.components.machines.cleanup.dockerImages.description',
        'Images no container uses.'
      ),
      removal: t(
        'auto.components.machines.cleanup.dockerImages.removal',
        'Runs docker image rm for each ticked image. Images a container uses are never listed.'
      )
    },
    'docker-dangling-images': {
      title: t(
        'auto.components.machines.cleanup.dockerDanglingImages.title',
        'Dangling Docker images'
      ),
      description: t(
        'auto.components.machines.cleanup.dockerDanglingImages.description',
        'Untagged image layers left behind by rebuilds and pulls.'
      ),
      removal: t(
        'auto.components.machines.cleanup.dockerDanglingImages.removal',
        'Runs docker image rm for each ticked image, like docker image prune. Tagged images and images a container uses are never listed.'
      )
    },
    'docker-containers': {
      title: t(
        'auto.components.machines.cleanup.dockerContainers.title',
        'Stopped Docker containers'
      ),
      description: t(
        'auto.components.machines.cleanup.dockerContainers.description',
        'Containers that exited or were never started.'
      ),
      removal: t(
        'auto.components.machines.cleanup.dockerContainers.removal',
        'Runs docker container rm for each ticked container. Files written inside it are deleted. Running containers are never listed.'
      )
    },
    'docker-volumes': {
      title: t('auto.components.machines.cleanup.dockerVolumes.title', 'Unused Docker volumes'),
      description: t(
        'auto.components.machines.cleanup.dockerVolumes.description',
        'Volumes no container references.'
      ),
      removal: t(
        'auto.components.machines.cleanup.dockerVolumes.removal',
        'Runs docker volume rm for each ticked volume. The data stored in it is deleted for good.'
      )
    },
    'docker-build-cache': {
      title: t('auto.components.machines.cleanup.dockerBuildCache.title', 'Docker build cache'),
      description: t(
        'auto.components.machines.cleanup.dockerBuildCache.description',
        'Layers kept to speed up image builds.'
      ),
      removal: t(
        'auto.components.machines.cleanup.dockerBuildCache.removal',
        'Runs docker builder prune --all. The next image builds start from scratch.'
      )
    },
    'package-caches': {
      title: t('auto.components.machines.cleanup.packageCaches.title', 'Package manager caches'),
      description: t(
        'auto.components.machines.cleanup.packageCaches.description',
        'Download caches of npm, pnpm, Yarn, pip, uv, Cargo, Go, Bun and Homebrew.'
      ),
      removal: t(
        'auto.components.machines.cleanup.packageCaches.removal',
        'Deletes each ticked folder. Package managers download what they need again on the next install.'
      )
    },
    'node-modules': {
      title: t('auto.components.machines.cleanup.nodeModules.title', 'node_modules folders'),
      description: t(
        'auto.components.machines.cleanup.nodeModules.description',
        'Installed dependencies of projects in your home folder.'
      ),
      removal: t(
        'auto.components.machines.cleanup.nodeModules.removal',
        "Deletes each ticked folder. Run that project's install again to get it back."
      )
    },
    trash: {
      title: t('auto.components.machines.cleanup.trash.title', 'Trash'),
      description: t(
        'auto.components.machines.cleanup.trash.description',
        'Files already moved to the trash.'
      ),
      removal: t(
        'auto.components.machines.cleanup.trash.removal',
        'Empties the trash. Nothing in it can be restored afterwards.'
      )
    },
    'old-logs': {
      title: t('auto.components.machines.cleanup.oldLogs.title', 'Old logs'),
      description: t(
        'auto.components.machines.cleanup.oldLogs.description',
        'Log files nothing has written to for 14 days.'
      ),
      removal: t(
        'auto.components.machines.cleanup.oldLogs.removal',
        'Deletes each ticked log file.'
      )
    },
    'seal-caches': {
      title: t('auto.components.machines.cleanup.sealCaches.title', 'Seal leftovers'),
      description: t(
        'auto.components.machines.cleanup.sealCaches.description',
        'Finished job records and temporary files Seal left on this machine.'
      ),
      removal: t(
        'auto.components.machines.cleanup.sealCaches.removal',
        'Deletes each ticked item. Jobs that are still running are never listed.'
      )
    }
  }
}

export type MachineDockerRemovalCopy = {
  /** The confirmation's title for that many picked objects. */
  title: (count: number, machine: string) => string
  removal: string
}

/** Removing objects picked in the Docker storage manager, where in-use ones are listed too. */
export function useMachineDockerRemovalCopy(): Record<
  MachineDockerStorageKind,
  MachineDockerRemovalCopy
> {
  const t = useTranslate()
  return {
    images: {
      title: (count, machine) =>
        t(
          'auto.components.machines.cleanup.removeImages.title',
          'Remove {{count}} images from {{machine}}?',
          { count, machine, defaultValue_one: 'Remove {{count}} image from {{machine}}?' }
        ),
      removal: t(
        'auto.components.machines.cleanup.removeImages.removal',
        'Runs docker image rm for each ticked image. Layers another image shares stay, so each size is what that image alone frees.'
      )
    },
    containers: {
      title: (count, machine) =>
        t(
          'auto.components.machines.cleanup.removeContainers.title',
          'Remove {{count}} containers from {{machine}}?',
          { count, machine, defaultValue_one: 'Remove {{count}} container from {{machine}}?' }
        ),
      removal: t(
        'auto.components.machines.cleanup.removeContainers.removal',
        'Runs docker container rm for each ticked container. Files written inside it are deleted. Its image and named volumes stay.'
      )
    },
    volumes: {
      title: (count, machine) =>
        t(
          'auto.components.machines.cleanup.removeVolumes.title',
          'Remove {{count}} volumes from {{machine}}?',
          { count, machine, defaultValue_one: 'Remove {{count}} volume from {{machine}}?' }
        ),
      removal: t(
        'auto.components.machines.cleanup.removeVolumes.removal',
        'Runs docker volume rm for each ticked volume. The data stored in it is deleted for good.'
      )
    },
    'build-cache': {
      title: (count, machine) =>
        t(
          'auto.components.machines.cleanup.removeBuildCache.title',
          'Remove {{count}} build cache records from {{machine}}?',
          {
            count,
            machine,
            defaultValue_one: 'Remove {{count}} build cache record from {{machine}}?'
          }
        ),
      removal: t(
        'auto.components.machines.cleanup.removeBuildCache.removal',
        'Runs docker builder prune for each ticked record. A build that needs it runs that step again.'
      )
    }
  }
}

export type MachineCleanupInUseCopy = {
  /** Under a listed item that stopped containers still use. */
  item: (containers: readonly string[]) => string
  /** Beside the confirm button once that many such items are ticked. */
  ticked: (count: number) => string
}

/** What removing an image or volume does to the stopped containers that still use it. */
export function useMachineCleanupInUseCopy(): (
  target: MachineCleanupTargetId
) => MachineCleanupInUseCopy {
  const t = useTranslate()
  return (target) =>
    target === 'docker-volumes'
      ? {
          item: (containers) =>
            t(
              'auto.components.machines.cleanup.inUse.volume',
              'Used by stopped containers {{names}}. Removing the volume also removes those containers, and its data is gone for good.',
              {
                count: containers.length,
                names: containers.join(', '),
                defaultValue_one:
                  'Used by stopped container {{names}}. Removing the volume also removes that container, and its data is gone for good.'
              }
            ),
          ticked: (count) =>
            t(
              'auto.components.machines.cleanup.inUse.volumesTicked',
              '{{count}} ticked volumes are used by stopped containers. Those containers are removed too, and the data cannot be recovered.',
              {
                count,
                defaultValue_one:
                  '{{count}} ticked volume is used by a stopped container. That container is removed too, and the data cannot be recovered.'
              }
            )
        }
      : {
          item: (containers) =>
            t(
              'auto.components.machines.cleanup.inUse.image',
              'Used by stopped containers {{names}}. Removing the image leaves those containers unable to start.',
              {
                count: containers.length,
                names: containers.join(', '),
                defaultValue_one:
                  'Used by stopped container {{names}}. Removing the image leaves that container unable to start.'
              }
            ),
          ticked: (count) =>
            t(
              'auto.components.machines.cleanup.inUse.imagesTicked',
              '{{count}} ticked images are used by stopped containers. Those containers cannot start once the images are gone.',
              {
                count,
                defaultValue_one:
                  '{{count}} ticked image is used by a stopped container. That container cannot start once the image is gone.'
              }
            )
        }
}
