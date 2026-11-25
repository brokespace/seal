import type { MachinesApi } from '../../../../preload/api/machines/machines-bridge'
import type {
  MachineDockerContainerRef,
  MachineDockerStorageKind
} from '../../../../shared/machines/machine-docker-types'
import { dockerImageKey } from '../../../../shared/machines/machine-docker-types'
import type {
  MachineCleanupItem,
  MachineCleanupTargetId,
  MachineDockerContainer
} from '../../../../shared/machines/machine-resource-types'
import {
  FAKE_DOCKER_LOG,
  FAKE_DOCKER_VOLUME_FILES,
  FAKE_DOCKER_VOLUME_TREE,
  fakeDockerDetails
} from './machine-docker-fixture-details'
import {
  EVAL_RUN,
  FAKE_DOCKER_BUILD_CACHE,
  FAKE_DOCKER_IMAGES,
  FAKE_DOCKER_INVENTORY,
  FAKE_DOCKER_STORED_CONTAINERS,
  FAKE_DOCKER_VOLUMES,
  GB,
  JUPYTER,
  MB,
  MLFLOW_OLD,
  POSTGRES,
  now
} from './machine-docker-fixture-inventory'

export {
  FAKE_DOCKER_BUILD_CACHE,
  FAKE_DOCKER_IMAGES,
  FAKE_DOCKER_INVENTORY,
  FAKE_DOCKER_STORED_CONTAINERS,
  FAKE_DOCKER_VOLUMES
}

function stats(
  ref: MachineDockerContainerRef,
  image: string,
  status: string,
  figures: Partial<MachineDockerContainer> = {}
): MachineDockerContainer {
  return {
    id: ref.id,
    name: ref.name,
    image,
    status,
    running: ref.running,
    memUsageBytes: null,
    memLimitBytes: null,
    memPercent: null,
    cpuPercent: null,
    netRxBytes: null,
    netTxBytes: null,
    blockReadBytes: null,
    blockWriteBytes: null,
    pids: null,
    ...figures
  }
}

export const FAKE_DOCKER_CONTAINERS: MachineDockerContainer[] = [
  stats(JUPYTER, 'jupyter/pytorch-notebook:latest', 'Up 5 hours', {
    memUsageBytes: 6.2 * GB,
    memLimitBytes: 32 * GB,
    memPercent: 19.4,
    cpuPercent: 211.8,
    netRxBytes: 48.3 * GB,
    netTxBytes: 912 * MB,
    blockReadBytes: 71 * GB,
    blockWriteBytes: 9.4 * GB,
    pids: 148
  }),
  stats(POSTGRES, 'postgres:16', 'Up 3 days', {
    memUsageBytes: 1.5 * GB,
    memLimitBytes: 4 * GB,
    memPercent: 37.5,
    cpuPercent: 2.1,
    netRxBytes: 1.2 * GB,
    netTxBytes: 6.8 * GB,
    blockReadBytes: 22 * GB,
    blockWriteBytes: 130 * GB,
    pids: 23
  }),
  stats(EVAL_RUN, 'seal/eval:2026.04', 'Exited (0) 2 weeks ago'),
  stats(MLFLOW_OLD, 'ghcr.io/mlflow/mlflow:v2.9.2', 'Exited (137) 7 months ago')
]

function removalItem(kind: MachineDockerStorageKind, key: string): MachineCleanupItem {
  const id = `${kind}:${key}`
  const base = { id, group: null, modifiedAt: null, preselected: true }
  if (kind === 'images') {
    const image = FAKE_DOCKER_IMAGES.find((candidate) => dockerImageKey(candidate) === key)
    const running = image?.usedBy.find((container) => container.running)
    return {
      ...base,
      label: image?.reference ?? key.replace(/^sha256:/, '').slice(0, 12),
      bytes: image?.uniqueBytes ?? null,
      ...(image && image.usedBy.length > 0
        ? { preselected: false, inUseBy: image.usedBy.map((container) => container.name) }
        : {}),
      ...(running
        ? { blocked: `Running container ${running.name} uses it. Stop the container first.` }
        : {})
    }
  }
  if (kind === 'volumes') {
    const volume = FAKE_DOCKER_VOLUMES.find((candidate) => candidate.name === key)
    const running = volume?.usedBy.find((container) => container.running)
    return {
      ...base,
      label: key,
      bytes: volume?.sizeBytes ?? null,
      ...(volume && volume.usedBy.length > 0
        ? { preselected: false, inUseBy: volume.usedBy.map((container) => container.name) }
        : {}),
      ...(running
        ? { blocked: `Running container ${running.name} uses it. Stop the container first.` }
        : {})
    }
  }
  if (kind === 'containers') {
    const container = FAKE_DOCKER_STORED_CONTAINERS.find((candidate) => candidate.id === key)
    return {
      ...base,
      label: container?.name ?? key.slice(0, 12),
      group: container ? `${container.image} · ${container.state}` : null,
      bytes: container?.sizeBytes ?? null,
      ...(container?.running ? { preselected: false, blocked: 'Running. Stop it first.' } : {})
    }
  }
  const record = FAKE_DOCKER_BUILD_CACHE.find((candidate) => candidate.id === key)
  return {
    ...base,
    label: record?.description ?? key,
    group: record?.cacheType ?? null,
    bytes: record?.sizeBytes ?? null,
    ...(record?.inUse ? { preselected: false, blocked: 'A build is using it.' } : {})
  }
}

const REMOVAL_TARGETS: Record<MachineDockerStorageKind, MachineCleanupTargetId> = {
  images: 'docker-images',
  containers: 'docker-containers',
  volumes: 'docker-volumes',
  'build-cache': 'docker-build-cache'
}

type MachineDockerApi = Pick<
  MachinesApi,
  | 'listDockerContainers'
  | 'dockerContainerAction'
  | 'dockerStorage'
  | 'dockerDetails'
  | 'dockerContainerLogs'
  | 'dockerVolumeListDir'
  | 'dockerVolumeReadFile'
  | 'planDockerRemoval'
  | 'onCleanupProgress'
>

/** A training box's Docker: running and stopped containers, used and unused images and volumes. */
export const fakeMachineDockerApi: MachineDockerApi = {
  listDockerContainers: async () => ({ state: 'ready', containers: FAKE_DOCKER_CONTAINERS }),
  dockerContainerAction: async () => {},
  dockerStorage: async () => ({ state: 'ready', ...FAKE_DOCKER_INVENTORY }),
  dockerDetails: async ({ target }) => fakeDockerDetails(target.kind, target.id),
  dockerContainerLogs: async () => ({ text: FAKE_DOCKER_LOG, truncated: false, collectedAt: now }),
  dockerVolumeListDir: async ({ path }) => {
    const entries = FAKE_DOCKER_VOLUME_TREE[path] ?? []
    return { path, entries, totalEntries: entries.length }
  },
  dockerVolumeReadFile: async ({ path }) => {
    const text = FAKE_DOCKER_VOLUME_FILES[path] ?? ''
    return { path, size: text.length, contentBase64: btoa(text), truncated: false }
  },
  planDockerRemoval: async ({ machineId, kind, keys }) => {
    const items = keys.map((key) => removalItem(kind, key))
    return {
      machineId,
      target: REMOVAL_TARGETS[kind],
      token: `removal:${kind}`,
      items,
      totalBytes: items.reduce((sum, item) => sum + (item.bytes ?? 0), 0),
      omittedCount: 0,
      unavailable: null
    }
  },
  onCleanupProgress: () => () => {}
}
