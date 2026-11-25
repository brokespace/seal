import type { MachineFileEntry } from './machine-types'

/** Why Docker did not answer: the account may not use it, its daemon is down, or something else. */
export type MachineDockerUnreachableReason = 'permission' | 'not-running' | 'other'

export type MachineDockerUnavailable =
  | { state: 'missing' }
  | { state: 'unreachable'; reason: MachineDockerUnreachableReason; message: string }

export type MachineDockerStorageKind = 'images' | 'containers' | 'volumes' | 'build-cache'

/** One row of `docker system df`. */
export type MachineDockerStorageRow = {
  kind: MachineDockerStorageKind
  count: number
  sizeBytes: number
  /** What pruning this kind would free: Docker's own figure, plus the build cache records an image shares. */
  reclaimableBytes: number
}

export type MachineDockerContainerRef = {
  /** The full 64-character id. */
  id: string
  name: string
  /** Docker's state word: `running`, `exited`, `created`, `paused`, `restarting`, `dead`. */
  state: string
  running: boolean
}

export type MachineDockerImage = {
  /** `sha256:…`. */
  id: string
  /** The first of `tags`, or null for an untagged (dangling) image. */
  reference: string | null
  /** Every `repository:tag` of the image; Docker keeps the image until the last one is removed. */
  tags: string[]
  sizeBytes: number | null
  /** What removing only this image frees; layers shared with other images stay. */
  uniqueBytes: number | null
  createdAt: number | null
  /** Containers created from it, running or not. Empty means unused. */
  usedBy: MachineDockerContainerRef[]
}

export type MachineDockerStoredContainer = MachineDockerContainerRef & {
  image: string
  imageId: string | null
  /** `Up 3 days`, `Exited (0) 2 weeks ago`. */
  status: string
  /** Its writable layer. */
  sizeBytes: number | null
  createdAt: number | null
  /** Names of the volumes it mounts. */
  volumes: string[]
}

export type MachineDockerVolume = {
  name: string
  driver: string
  mountpoint: string
  /** Null when the driver reports no size. */
  sizeBytes: number | null
  /** Containers that mount it, running or not. Empty means unused. */
  usedBy: MachineDockerContainerRef[]
}

export type MachineDockerBuildCacheRecord = {
  id: string
  /** `regular`, `source.local`, `exec.cachemount`, … */
  cacheType: string
  description: string
  sizeBytes: number | null
  inUse: boolean
  shared: boolean
  createdAt: number | null
  lastUsedAt: number | null
}

export type MachineDockerInventory = {
  rows: MachineDockerStorageRow[]
  images: MachineDockerImage[]
  containers: MachineDockerStoredContainer[]
  volumes: MachineDockerVolume[]
  /** Largest first; hosts with more records list only the biggest. */
  buildCache: MachineDockerBuildCacheRecord[]
  buildCacheOmitted: number
  collectedAt: number
}

export type MachineDockerStorage =
  | MachineDockerUnavailable
  | ({ state: 'ready' } & MachineDockerInventory)

/** Names an image for selection and removal: a tag is removed by reference, an untagged image by id. */
export function dockerImageKey(image: Pick<MachineDockerImage, 'id' | 'reference'>): string {
  return image.reference ?? image.id
}

export type MachineDockerDetailKind = 'container' | 'image' | 'volume'

export type MachineDockerDetailTarget = { kind: MachineDockerDetailKind; id: string }

export type MachineDockerContainerMount = {
  /** `volume`, `bind`, `tmpfs`. */
  type: string
  /** The volume's name, for a volume mount. */
  volume: string | null
  source: string
  destination: string
  readOnly: boolean
}

export type MachineDockerContainerDetails = MachineDockerContainerRef & {
  kind: 'container'
  image: string
  imageId: string | null
  command: string
  createdAt: number | null
  startedAt: number | null
  finishedAt: number | null
  exitCode: number | null
  restartCount: number
  /** `healthy`, `unhealthy`, `starting`; null without a health check. */
  health: string | null
  oomKilled: boolean
  /** What Docker recorded when the container failed to start. */
  error: string | null
  restartPolicy: string | null
  /** `0.0.0.0:8080->80/tcp` */
  ports: string[]
  networks: string[]
  mounts: MachineDockerContainerMount[]
}

export type MachineDockerImageLayer = {
  /** The build step that made the layer. */
  createdBy: string
  sizeBytes: number | null
  createdAt: number | null
}

export type MachineDockerImageDetails = {
  kind: 'image'
  id: string
  tags: string[]
  digests: string[]
  createdAt: number | null
  sizeBytes: number | null
  architecture: string | null
  os: string | null
  /** Newest first, as `docker history` lists them. */
  layers: MachineDockerImageLayer[]
  containers: MachineDockerContainerRef[]
}

export type MachineDockerVolumeDetails = {
  kind: 'volume'
  name: string
  driver: string
  mountpoint: string
  scope: string | null
  createdAt: number | null
  labels: Record<string, string>
  options: Record<string, string>
  containers: (MachineDockerContainerRef & { destination: string | null; readOnly: boolean })[]
}

export type MachineDockerDetails =
  | MachineDockerContainerDetails
  | MachineDockerImageDetails
  | MachineDockerVolumeDetails

export type MachineDockerLogs = {
  /** stdout and stderr interleaved as Docker recorded them, newest last. */
  text: string
  /** Older lines exist that were not fetched. */
  truncated: boolean
  collectedAt: number
}

/** Lines of a container's log fetched at once. */
export const MACHINE_DOCKER_LOG_TAIL_LINES = 500

/** One folder of a volume; `path` is absolute inside the volume, `/` being its root. */
export type MachineDockerVolumeListing = {
  path: string
  entries: MachineFileEntry[]
  totalEntries: number
}

/** A volume's files preview at most this much. */
export const MACHINE_DOCKER_VOLUME_PREVIEW_MAX_BYTES = 2 * 1024 * 1024
