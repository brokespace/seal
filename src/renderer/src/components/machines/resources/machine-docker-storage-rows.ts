import {
  dockerImageKey,
  type MachineDockerBuildCacheRecord,
  type MachineDockerContainerRef,
  type MachineDockerImage,
  type MachineDockerInventory,
  type MachineDockerStorageKind,
  type MachineDockerStoredContainer,
  type MachineDockerVolume
} from '../../../../../shared/machines/machine-docker-types'
import type { MachineCleanupTargetId } from '../../../../../shared/machines/machine-resource-types'

export const MACHINE_DOCKER_STORAGE_KINDS = [
  'images',
  'containers',
  'volumes',
  'build-cache'
] as const satisfies readonly MachineDockerStorageKind[]

/** The prunes each kind offers, the first being its button and the rest its menu. */
export const MACHINE_DOCKER_STORAGE_PRUNES = {
  images: ['docker-dangling-images', 'docker-images'],
  containers: ['docker-containers'],
  volumes: ['docker-volumes'],
  'build-cache': ['docker-build-cache']
} as const satisfies Record<MachineDockerStorageKind, readonly MachineCleanupTargetId[]>

export type MachineDockerStoragePrune =
  (typeof MACHINE_DOCKER_STORAGE_PRUNES)[MachineDockerStorageKind][number]

export type MachineDockerStorageStatus =
  | 'in-use'
  /** Only stopped containers reference it, so Docker still keeps it. */
  | 'stopped-only'
  | 'dangling'
  | 'unused'
  | 'shared'
  | 'running'
  | 'stopped'

export type MachineDockerStorageSort =
  | 'name'
  | 'status'
  | 'size'
  | 'frees'
  | 'created'
  | 'volumes'
  | 'driver'
  | 'type'
  | 'lastUsed'

type ItemBase = {
  /** What selection and `planDockerRemoval` name it by. */
  key: string
  name: string
  status: MachineDockerStorageStatus
  sizeBytes: number | null
  /** What removing it alone gives back. */
  freesBytes: number | null
  createdAt: number | null
  /** Names of the containers that reference it. */
  usedBy: readonly string[]
}

export type MachineDockerStorageItem =
  | (ItemBase & { kind: 'images'; image: MachineDockerImage })
  | (ItemBase & { kind: 'containers'; container: MachineDockerStoredContainer })
  | (ItemBase & { kind: 'volumes'; volume: MachineDockerVolume })
  | (ItemBase & { kind: 'build-cache'; record: MachineDockerBuildCacheRecord })

export function shortDockerId(id: string): string {
  return id.replace(/^sha256:/, '').slice(0, 12)
}

/** A running user outranks stopped ones; an untagged object nothing uses is dangling. */
export function dockerUsageStatus(
  usedBy: readonly MachineDockerContainerRef[],
  tagged = true
): MachineDockerStorageStatus {
  if (usedBy.some((container) => container.running)) {
    return 'in-use'
  }
  if (usedBy.length > 0) {
    return 'stopped-only'
  }
  return tagged ? 'unused' : 'dangling'
}

/** The exit code in `Exited (137) 7 months ago`. */
export function dockerContainerExitCode(status: string): number | null {
  const code = /^Exited \((\d+)\)/.exec(status)?.[1]
  return code === undefined ? null : Number(code)
}

export function dockerStorageItems(
  inventory: MachineDockerInventory,
  kind: MachineDockerStorageKind
): MachineDockerStorageItem[] {
  switch (kind) {
    case 'images':
      return inventory.images.map((image) => ({
        kind,
        key: dockerImageKey(image),
        name: image.reference ?? shortDockerId(image.id),
        status: dockerUsageStatus(image.usedBy, image.reference !== null),
        sizeBytes: image.sizeBytes,
        freesBytes: image.uniqueBytes,
        createdAt: image.createdAt,
        usedBy: image.usedBy.map((container) => container.name),
        image
      }))
    case 'containers':
      return inventory.containers.map((container) => ({
        kind,
        key: container.id,
        name: container.name,
        status: container.running ? 'running' : 'stopped',
        sizeBytes: container.sizeBytes,
        freesBytes: container.sizeBytes,
        createdAt: container.createdAt,
        usedBy: [],
        container
      }))
    case 'volumes':
      return inventory.volumes.map((volume) => ({
        kind,
        key: volume.name,
        name: volume.name,
        status: dockerUsageStatus(volume.usedBy),
        sizeBytes: volume.sizeBytes,
        freesBytes: volume.sizeBytes,
        createdAt: null,
        usedBy: volume.usedBy.map((container) => container.name),
        volume
      }))
    case 'build-cache':
      return inventory.buildCache.map((record) => ({
        kind,
        key: record.id,
        name: record.description || record.id,
        status: record.inUse ? 'in-use' : record.shared ? 'shared' : 'unused',
        sizeBytes: record.sizeBytes,
        freesBytes: record.sizeBytes,
        createdAt: record.createdAt,
        usedBy: [],
        record
      }))
  }
}

/** A prune takes it: nothing references it, or it is a cache record an image only shares. */
export function isDockerStorageItemReclaimable(item: MachineDockerStorageItem): boolean {
  return ['unused', 'dangling', 'stopped', 'shared'].includes(item.status)
}

/** How many listed objects a prune target would take; zero means its button has nothing to do. */
export function dockerPruneCandidateCount(
  inventory: MachineDockerInventory,
  target: MachineDockerStoragePrune
): number {
  const count = (kind: MachineDockerStorageKind, statuses: MachineDockerStorageStatus[]): number =>
    dockerStorageItems(inventory, kind).filter((item) => statuses.includes(item.status)).length
  switch (target) {
    case 'docker-dangling-images':
      return count('images', ['dangling'])
    case 'docker-images':
      return count('images', ['dangling', 'unused'])
    case 'docker-containers':
      return count('containers', ['stopped'])
    case 'docker-volumes':
      return count('volumes', ['unused'])
    case 'docker-build-cache':
      return count('build-cache', ['unused', 'shared']) + inventory.buildCacheOmitted
  }
}

function searchText(item: MachineDockerStorageItem): string[] {
  switch (item.kind) {
    case 'images':
      return [item.name, item.image.id, ...item.image.tags, ...item.usedBy]
    case 'containers':
      return [
        item.name,
        item.container.id,
        item.container.image,
        item.container.status,
        ...item.container.volumes
      ]
    case 'volumes':
      return [item.name, item.volume.driver, item.volume.mountpoint, ...item.usedBy]
    case 'build-cache':
      return [item.name, item.record.id, item.record.cacheType]
  }
}

export function filterDockerStorageItems(
  items: readonly MachineDockerStorageItem[],
  options: { filter: string; reclaimableOnly: boolean }
): MachineDockerStorageItem[] {
  const needle = options.filter.trim().toLowerCase()
  return items.filter(
    (item) =>
      (!options.reclaimableOnly || isDockerStorageItemReclaimable(item)) &&
      (needle === '' || searchText(item).some((text) => text.toLowerCase().includes(needle)))
  )
}

/** Ascending puts what a cleanup would take first. */
const STATUS_RANK: Record<MachineDockerStorageStatus, number> = {
  dangling: 0,
  unused: 1,
  stopped: 1,
  shared: 2,
  'stopped-only': 3,
  'in-use': 4,
  running: 4
}

function sortValue(
  item: MachineDockerStorageItem,
  sort: MachineDockerStorageSort
): string | number | null {
  switch (sort) {
    case 'name':
      return item.name.toLowerCase()
    case 'status':
      return STATUS_RANK[item.status]
    case 'size':
      return item.sizeBytes
    case 'frees':
      return item.freesBytes
    case 'created':
      return item.createdAt
    case 'volumes':
      return item.kind === 'containers' ? item.container.volumes.length : null
    case 'driver':
      return item.kind === 'volumes' ? item.volume.driver.toLowerCase() : null
    case 'type':
      return item.kind === 'build-cache' ? item.record.cacheType.toLowerCase() : null
    case 'lastUsed':
      return item.kind === 'build-cache' ? item.record.lastUsedAt : null
  }
}

/** Text and status read top-down first; sizes and dates start at the largest and newest. */
export function dockerStorageSortStartsDescending(sort: MachineDockerStorageSort): boolean {
  return sort !== 'name' && sort !== 'status' && sort !== 'driver' && sort !== 'type'
}

function compareValues(a: string | number, b: string | number): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
}

/** Items with no value for the column stay at the bottom in either direction. */
export function sortDockerStorageItems(
  items: readonly MachineDockerStorageItem[],
  sort: MachineDockerStorageSort,
  descending: boolean
): MachineDockerStorageItem[] {
  return [...items].sort((a, b) => {
    const left = sortValue(a, sort)
    const right = sortValue(b, sort)
    if (left === null || right === null) {
      if (left !== right) {
        return left === null ? 1 : -1
      }
    } else {
      const order = compareValues(left, right)
      if (order !== 0) {
        return descending ? -order : order
      }
    }
    return a.name.localeCompare(b.name) || a.key.localeCompare(b.key)
  })
}

export function dockerStorageSelectionTotal(
  items: readonly MachineDockerStorageItem[],
  selected: ReadonlySet<string>
): { count: number; bytes: number } {
  const picked = items.filter((item) => selected.has(item.key))
  return {
    count: picked.length,
    bytes: picked.reduce((sum, item) => sum + (item.freesBytes ?? 0), 0)
  }
}

/** Count and size of each kind; `docker system df` knows the size shared layers really take. */
export function dockerStorageCategoryTotals(
  inventory: MachineDockerInventory
): Record<MachineDockerStorageKind, { count: number; sizeBytes: number }> {
  const total = (
    kind: MachineDockerStorageKind,
    count: number,
    listed: readonly { sizeBytes: number | null }[]
  ): { count: number; sizeBytes: number } => ({
    count,
    sizeBytes:
      inventory.rows.find((row) => row.kind === kind)?.sizeBytes ??
      listed.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0)
  })
  return {
    images: total('images', inventory.images.length, inventory.images),
    containers: total('containers', inventory.containers.length, inventory.containers),
    volumes: total('volumes', inventory.volumes.length, inventory.volumes),
    'build-cache': total(
      'build-cache',
      inventory.buildCache.length + inventory.buildCacheOmitted,
      inventory.buildCache
    )
  }
}
