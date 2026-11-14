import { useTranslate } from '@/i18n/use-translate'
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
