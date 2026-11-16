import {
  dockerImageKey,
  type MachineDockerContainerRef,
  type MachineDockerImage,
  type MachineDockerStorageKind,
  type MachineDockerStoredContainer,
  type MachineDockerUnavailable,
  type MachineDockerVolume
} from '../../../shared/machines/machine-docker-types'
import type { MachineCleanupTargetId } from '../../../shared/machines/machine-resource-types'
import type { MachineConnection } from '../connection/machine-connection'
import type { MachineCleanupPlan, PlannedCleanupItem } from './machine-cleanup-plan'
import {
  readMachineDockerStorage,
  type DockerBuildCacheRecord,
  type DockerInventory,
  type DockerStorage
} from './machine-docker-inventory'
import { DOCKER_CONTAINER_ID, DOCKER_NAME, shortDockerId } from './machine-docker-output'

export type MachineDockerCleanupTarget = Extract<
  MachineCleanupTargetId,
  | 'docker-images'
  | 'docker-dangling-images'
  | 'docker-containers'
  | 'docker-volumes'
  | 'docker-build-cache'
>

export function isDockerCleanupTarget(
  target: MachineCleanupTargetId
): target is MachineDockerCleanupTarget {
  return target.startsWith('docker-')
}

type Draft = Omit<PlannedCleanupItem, 'id'>

function runningUserBlock(usedBy: readonly MachineDockerContainerRef[]): string | null {
  const running = usedBy.find((container) => container.running)
  return running ? `Running container ${running.name} uses it. Stop the container first.` : null
}

function imageItem(
  inventory: DockerInventory,
  image: MachineDockerImage,
  preselected: boolean
): Draft | null {
  const target = dockerImageKey(image)
  if (!DOCKER_NAME.test(target) || !DOCKER_NAME.test(image.id)) {
    return null
  }
  const item = {
    label: image.reference ?? shortDockerId(image.id),
    group: null,
    bytes: image.uniqueBytes,
    modifiedAt: null
  }
  const blocked = runningUserBlock(image.usedBy)
  if (blocked || image.usedBy.length === 0) {
    return {
      ...item,
      preselected: !blocked && preselected,
      ...(blocked ? { blocked } : {}),
      action: { kind: 'docker-image', target, force: false }
    }
  }
  // Forcing a tag away leaves the image behind untagged; by id Docker deletes it.
  const onlyTag = inventory.images.filter((other) => other.id === image.id).length === 1
  return {
    ...item,
    preselected: false,
    inUseBy: image.usedBy.map((container) => container.name),
    action: { kind: 'docker-image', target: onlyTag ? image.id : target, force: true }
  }
}

function containerItem(
  container: MachineDockerStoredContainer,
  preselected: boolean
): Draft | null {
  if (!DOCKER_CONTAINER_ID.test(container.id)) {
    return null
  }
  return {
    label: container.name || shortDockerId(container.id),
    group: `${container.image} · ${container.state}`,
    bytes: container.sizeBytes,
    modifiedAt: null,
    preselected: !container.running && preselected,
    ...(container.running ? { blocked: 'Running. Stop it first.' } : {}),
    action: { kind: 'docker', args: ['container', 'rm', container.id] }
  }
}

function volumeItem(volume: MachineDockerVolume, preselected: boolean): Draft | null {
  const users = volume.usedBy.map((container) => container.id)
  if (!DOCKER_NAME.test(volume.name) || !users.every((id) => DOCKER_CONTAINER_ID.test(id))) {
    return null
  }
  const item = { label: volume.name, group: null, bytes: volume.sizeBytes, modifiedAt: null }
  const remove = ['volume', 'rm', volume.name]
  const blocked = runningUserBlock(volume.usedBy)
  if (blocked || users.length === 0) {
    return {
      ...item,
      preselected: !blocked && preselected,
      ...(blocked ? { blocked } : {}),
      action: { kind: 'docker', args: remove }
    }
  }
  // Docker keeps a volume while any container references it, stopped or not.
  return {
    ...item,
    preselected: false,
    inUseBy: volume.usedBy.map((container) => container.name),
    action: { kind: 'docker-sequence', commands: [['container', 'rm', ...users], remove] }
  }
}

function buildCacheItem(record: DockerBuildCacheRecord): Draft | null {
  if (!DOCKER_NAME.test(record.id)) {
    return null
  }
  return {
    label: record.description || record.id,
    group: record.cacheType || null,
    bytes: record.sizeBytes,
    modifiedAt: record.lastUsedAt,
    preselected: !record.inUse,
    ...(record.inUse ? { blocked: 'A build is using it.' } : {}),
    action: { kind: 'docker-build-cache', record: record.id }
  }
}

/** Docker keeps a record another record builds on, so the ones built last are removed first. */
function childrenFirst(records: readonly DockerBuildCacheRecord[]): DockerBuildCacheRecord[] {
  const byId = new Map(records.map((record) => [record.id, record]))
  const depths = new Map<string, number>()
  const depth = (record: DockerBuildCacheRecord): number => {
    const known = depths.get(record.id)
    if (known !== undefined) {
      return known
    }
    depths.set(record.id, 0)
    const parents = record.parents.flatMap((id) => byId.get(id) ?? [])
    const value = parents.reduce((deepest, parent) => Math.max(deepest, depth(parent) + 1), 0)
    depths.set(record.id, value)
    return value
  }
  return [...records].sort((a, b) => depth(b) - depth(a))
}

function plan(
  target: MachineDockerCleanupTarget,
  drafts: readonly (Draft | null)[]
): MachineCleanupPlan {
  return {
    items: drafts
      .filter((draft) => draft !== null)
      .map((draft, index) => ({ ...draft, id: `${target}:${index}` })),
    omittedCount: 0,
    unavailable: null
  }
}

function unavailablePlan(storage: MachineDockerUnavailable): MachineCleanupPlan {
  return {
    items: [],
    omittedCount: 0,
    unavailable:
      storage.state === 'missing' ? 'Docker is not installed on this machine.' : storage.message
  }
}

// Only what holds no data of its own is ticked without being asked.
const TICKED: Record<MachineDockerCleanupTarget, boolean> = {
  'docker-images': false,
  'docker-dangling-images': true,
  'docker-containers': false,
  'docker-volumes': false,
  'docker-build-cache': true
}

/** What one prune target would remove: only objects nothing uses. */
export function dockerCleanupPlan(
  storage: DockerStorage,
  target: MachineDockerCleanupTarget
): MachineCleanupPlan {
  if (storage.state !== 'ready') {
    return unavailablePlan(storage)
  }
  const ticked = TICKED[target]
  switch (target) {
    case 'docker-images':
    case 'docker-dangling-images':
      return plan(
        target,
        storage.images
          .filter(
            (image) =>
              image.usedBy.length === 0 && (target === 'docker-images' || image.reference === null)
          )
          .map((image) => imageItem(storage, image, ticked))
      )
    case 'docker-containers':
      return plan(
        target,
        storage.containers
          .filter((container) => !container.running)
          .map((container) => containerItem(container, ticked))
      )
    case 'docker-volumes':
      return plan(
        target,
        storage.volumes
          .filter((volume) => volume.usedBy.length === 0)
          .map((volume) => volumeItem(volume, ticked))
      )
    case 'docker-build-cache': {
      // Records can run to thousands, so the prune is one item. Docker's own total leaves out
      // shared records, which `--all` removes too, so the listed records are added up when all are listed.
      const bytes =
        storage.buildCacheOmitted === 0
          ? storage.buildCache
              .filter((record) => !record.inUse)
              .reduce((sum, record) => sum + (record.sizeBytes ?? 0), 0)
          : (storage.rows.find((row) => row.kind === 'build-cache')?.reclaimableBytes ?? 0)
      return plan(
        target,
        bytes > 0
          ? [
              {
                label: 'docker builder prune --all',
                group: null,
                bytes,
                modifiedAt: null,
                preselected: ticked,
                action: { kind: 'docker-build-cache', record: null }
              }
            ]
          : []
      )
    }
  }
}

const TARGET_OF_KIND: Record<MachineDockerStorageKind, MachineDockerCleanupTarget> = {
  images: 'docker-images',
  containers: 'docker-containers',
  volumes: 'docker-volumes',
  'build-cache': 'docker-build-cache'
}

/**
 * What removing the picked objects would do. Keys only choose among what the machine listed, so
 * one that names nothing there is dropped; objects in use come back unticked or blocked.
 */
export function dockerRemovalPlan(
  storage: DockerStorage,
  kind: MachineDockerStorageKind,
  keys: readonly string[]
): { target: MachineDockerCleanupTarget; plan: MachineCleanupPlan } {
  const target = TARGET_OF_KIND[kind]
  if (!target) {
    throw new Error('Unknown kind of Docker object')
  }
  if (storage.state !== 'ready') {
    return { target, plan: unavailablePlan(storage) }
  }
  const picked = new Set(keys)
  const drafts: Record<MachineDockerStorageKind, () => (Draft | null)[]> = {
    images: () =>
      storage.images
        .filter((image) => picked.has(dockerImageKey(image)))
        .map((image) => imageItem(storage, image, true)),
    containers: () =>
      storage.containers
        .filter((container) => picked.has(container.id))
        .map((container) => containerItem(container, true)),
    volumes: () =>
      storage.volumes
        .filter((volume) => picked.has(volume.name))
        .map((volume) => volumeItem(volume, true)),
    'build-cache': () =>
      childrenFirst(storage.buildCache.filter((record) => picked.has(record.id))).map(
        buildCacheItem
      )
  }
  return { target, plan: plan(target, drafts[kind]()) }
}

export async function scanDockerCleanupTarget(
  connection: MachineConnection,
  target: MachineDockerCleanupTarget
): Promise<MachineCleanupPlan> {
  return dockerCleanupPlan(await readMachineDockerStorage(connection), target)
}

/** Reads the machine again first: a plan from a stale listing would name the wrong users. */
export async function planMachineDockerRemoval(
  connection: MachineConnection,
  kind: MachineDockerStorageKind,
  keys: readonly string[]
): Promise<{ target: MachineDockerCleanupTarget; plan: MachineCleanupPlan }> {
  return dockerRemovalPlan(await readMachineDockerStorage(connection, { force: true }), kind, keys)
}
