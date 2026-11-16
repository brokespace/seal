import type {
  MachineDockerBuildCacheRecord,
  MachineDockerImage,
  MachineDockerInventory,
  MachineDockerStorageKind,
  MachineDockerStorageRow,
  MachineDockerStoredContainer,
  MachineDockerUnavailable,
  MachineDockerVolume
} from '../../../shared/machines/machine-docker-types'
import type { MachineConnection } from '../connection/machine-connection'
import {
  containerRef,
  DOCKER_CONTAINER_LIMIT,
  DOCKER_CONTAINER_USE_COMMAND,
  DOCKER_TRY_FUNCTION,
  dockerJsonRows,
  dockerText,
  parseDockerContainerUses,
  parseDockerSize,
  parseDockerTime,
  parseDockerUnavailable,
  sameDockerId
} from './machine-docker-output'
import { runMachineHostScript } from './machine-host-script'

const READ_TIMEOUT_MS = 3 * 60_000
/** `docker system df` is slow on a busy daemon; every reader within this window shares one answer. */
const SHARE_READ_MS = 20_000
const IMAGE_LIMIT = 500
const VOLUME_LIMIT = 500
const BUILD_CACHE_LIMIT = 500

/** A record Docker keeps while another record names it as a parent. */
export type DockerBuildCacheRecord = MachineDockerBuildCacheRecord & { parents: string[] }

export type DockerInventory = Omit<MachineDockerInventory, 'buildCache'> & {
  buildCache: DockerBuildCacheRecord[]
}

export type DockerStorage = MachineDockerUnavailable | ({ state: 'ready' } & DockerInventory)

// Containers name only fields every Docker has: their labels and commands have no size limit.
const DETAIL_FORMAT = [
  '{{range .Images}}@i {{json .}}\\n{{end}}',
  '{{range .Containers}}@c {"ID":{{json .ID}},"CreatedAt":{{json .CreatedAt}},"Status":{{json .Status}},"Size":{{json .Size}}}\\n{{end}}',
  '{{range .Volumes}}@v {"Name":{{json .Name}},"Links":{{json .Links}},"Size":{{json .Size}}}\\n{{end}}',
  '{{range .BuildCache}}@b {{json .}}\\n{{end}}'
].join('')

// Puts `<kind>\t<bytes>\t` before each row so `sort` can order a kind by size; a build step's long
// command is cut inside its JSON string, never across an escape.
const RANK_BY_SIZE = String.raw`
function bytes(text,   unit) {
  sub(/ .*/, "", text)
  unit = text
  gsub(/[0-9.]/, "", unit)
  return (text + 0) * (unit == "B" ? 1 : unit ~ /^[kK]B$/ ? 1e3 : unit == "MB" ? 1e6 : unit == "GB" ? 1e9 : unit == "TB" ? 1e12 : 0)
}
function clip(line,   head, body) {
  if (!match(line, /"Description":"([^"\\]|\\.)*"/) || RLENGTH <= 260) return line
  head = substr(line, 1, RSTART + 14)
  body = substr(line, RSTART + 15, 240)
  sub(/\\+[^\\]?[^\\]?[^\\]?[^\\]?[^\\]?$/, "", body)
  return head body substr(line, RSTART + RLENGTH - 1)
}
{
  size = match($0, /"Size":"[^"]*"/) ? bytes(substr($0, RSTART + 8, RLENGTH - 9)) : 0
  printf "%s\t%.0f\t%s\n", substr($0, 1, 2), size, clip($0)
}
`

// One answer has to fit the transport's output cap, so each kind keeps only its largest rows.
const KEEP_LARGEST = String.raw`
BEGIN { cap["@i"] = ${IMAGE_LIMIT}; cap["@c"] = ${DOCKER_CONTAINER_LIMIT}; cap["@v"] = ${VOLUME_LIMIT}; cap["@b"] = ${BUILD_CACHE_LIMIT} }
!($1 in cap) { next }
{ seen[$1]++ }
seen[$1] <= cap[$1] { sub(/^[^\t]*\t[^\t]*\t/, ""); print }
END { if (seen["@b"] > cap["@b"]) print "@omitted " (seen["@b"] - cap["@b"]) }
`

export const DOCKER_INVENTORY_SCRIPT = `
${DOCKER_TRY_FUNCTION}
seal_docker_try docker system df --format '{{json .}}' || return 0
printf '%s\\n' "$seal_docker_out" | sed 's/^/@d /'
seal_tab=$(printf '\\t')
seal_docker_detail=$(docker system df -v --format '${DETAIL_FORMAT}' 2>/dev/null | awk '${RANK_BY_SIZE}' | sort -t "$seal_tab" -k1,1 -k2,2nr | awk -F '\\t' '${KEEP_LARGEST}')
printf '%s\\n' "$seal_docker_detail"
printf '%s\\n' "$seal_docker_detail" | sed -n 's/^@c {"ID":"\\([0-9a-f]*\\)".*/\\1/p' | ${DOCKER_CONTAINER_USE_COMMAND}
docker volume ls --format '{"Name":{{json .Name}},"Driver":{{json .Driver}},"Mountpoint":{{json .Mountpoint}}}' 2>/dev/null | head -n ${VOLUME_LIMIT} | sed 's/^/@m /'
`

const STORAGE_KINDS: Record<string, MachineDockerStorageKind> = {
  Images: 'images',
  Containers: 'containers',
  'Local Volumes': 'volumes',
  'Build Cache': 'build-cache'
}

function size(value: unknown): number | null {
  return parseDockerSize(dockerText(value))
}

function count(value: unknown): number {
  return Number.parseInt(dockerText(value), 10) || 0
}

/** Reads what `DOCKER_INVENTORY_SCRIPT` printed. */
export function parseDockerInventory(output: string, collectedAt: number): DockerStorage {
  const lines = output.split(/\r?\n/)
  const unavailable = parseDockerUnavailable(lines)
  if (unavailable) {
    return unavailable
  }
  const rows: MachineDockerStorageRow[] = dockerJsonRows(lines, '@d ').flatMap((row) => {
    const kind = STORAGE_KINDS[dockerText(row.Type)]
    return kind
      ? [
          {
            kind,
            count: count(row.TotalCount),
            sizeBytes: size(row.Size) ?? 0,
            reclaimableBytes: size(row.Reclaimable) ?? 0
          }
        ]
      : []
  })
  const uses = parseDockerContainerUses(lines)
  const listed = dockerJsonRows(lines, '@c ')
  const containers: MachineDockerStoredContainer[] = uses.map((use) => {
    const row = listed.find((candidate) => sameDockerId(dockerText(candidate.ID), use.id))
    return {
      ...containerRef(use),
      image: use.image,
      imageId: use.imageId,
      status: dockerText(row?.Status),
      sizeBytes: size(row?.Size),
      createdAt: parseDockerTime(row?.CreatedAt),
      volumes: use.mounts.flatMap((mount) => (mount.volume ? [mount.volume] : []))
    }
  })
  const images: MachineDockerImage[] = dockerJsonRows(lines, '@i ').map((row) => {
    const id = dockerText(row.ID)
    const [repository, tag] = [dockerText(row.Repository), dockerText(row.Tag)]
    const tagged = repository !== '' && repository !== '<none>' && tag !== '' && tag !== '<none>'
    return {
      id,
      reference: tagged ? `${repository}:${tag}` : null,
      sizeBytes: size(row.Size),
      uniqueBytes: size(row.UniqueSize),
      createdAt: parseDockerTime(row.CreatedAt),
      usedBy: containers
        .filter((container) => container.imageId !== null && sameDockerId(container.imageId, id))
        .map(containerRef)
    }
  })
  const placed = new Map(dockerJsonRows(lines, '@m ').map((row) => [dockerText(row.Name), row]))
  const volumes: MachineDockerVolume[] = dockerJsonRows(lines, '@v ').map((row) => {
    const name = dockerText(row.Name)
    return {
      name,
      driver: dockerText(placed.get(name)?.Driver) || 'local',
      mountpoint: dockerText(placed.get(name)?.Mountpoint),
      sizeBytes: size(row.Size),
      usedBy: containers.filter((container) => container.volumes.includes(name)).map(containerRef)
    }
  })
  const buildCache: DockerBuildCacheRecord[] = dockerJsonRows(lines, '@b ').map((row) => ({
    id: dockerText(row.ID),
    cacheType: dockerText(row.CacheType),
    description: dockerText(row.Description),
    sizeBytes: size(row.Size),
    inUse: row.InUse === 'true',
    shared: row.Shared === 'true',
    createdAt: parseDockerTime(row.CreatedAt),
    lastUsedAt: parseDockerTime(row.LastUsedAt),
    parents: dockerText(row.Parent)
      .split(/[\s,]+/)
      .filter(Boolean)
  }))
  const omitted = lines.find((line) => line.startsWith('@omitted '))
  return {
    state: 'ready',
    rows,
    images,
    containers,
    volumes,
    buildCache,
    buildCacheOmitted: omitted ? count(omitted.slice('@omitted '.length)) : 0,
    collectedAt
  }
}

const shared = new Map<string, { at: number; storage: Promise<DockerStorage> }>()

export function forgetDockerInventory(connection: MachineConnection): void {
  shared.delete(connection.machineId)
}

/** `force` reads the machine again instead of sharing a recent answer. */
export function readMachineDockerStorage(
  connection: MachineConnection,
  options: { force?: boolean } = {}
): Promise<DockerStorage> {
  const cached = shared.get(connection.machineId)
  if (cached && !options.force && Date.now() - cached.at < SHARE_READ_MS) {
    return cached.storage
  }
  const entry = {
    at: Date.now(),
    storage: runMachineHostScript(connection, DOCKER_INVENTORY_SCRIPT, {
      timeoutMs: READ_TIMEOUT_MS
    }).then((result) => parseDockerInventory(result.stdout, Date.now()))
  }
  shared.set(connection.machineId, entry)
  entry.storage.catch(() => {
    if (shared.get(connection.machineId) === entry) {
      shared.delete(connection.machineId)
    }
  })
  return entry.storage
}
