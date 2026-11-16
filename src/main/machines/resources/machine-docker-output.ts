import type {
  MachineDockerContainerMount,
  MachineDockerContainerRef,
  MachineDockerUnavailable,
  MachineDockerUnreachableReason
} from '../../../shared/machines/machine-docker-types'
import type { MachineExecResult } from '../../../shared/machines/machine-host-wire'
import { firstErrorLine } from './machine-host-script'

export const DOCKER_CONTAINER_ID = /^[0-9a-f]{12,64}$/
/** Image references and ids, container, volume and build cache names: nothing a shell reads as syntax. */
export const DOCKER_NAME = /^[A-Za-z0-9][\w./:@-]*$/

/** One `docker container inspect` pass may name at most this many containers. */
export const DOCKER_CONTAINER_LIMIT = 500

const UNIT_BYTES: Record<string, number> = {
  B: 1,
  kB: 1e3,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4
}

/** Docker prints sizes as `12.2MB` (df) or `328KiB` (stats). */
export function parseDockerSize(text: string): number | null {
  const match = /^\s*([\d.]+)\s*([A-Za-z]+)/.exec(text)
  const unit = match ? UNIT_BYTES[match[2]] : undefined
  return match && unit ? Math.round(Number(match[1]) * unit) : null
}

/** `1.35kB / 126B`, as `docker stats` prints what went in and out. */
export function parseDockerSizePair(text: string): [number | null, number | null] {
  const [first, second] = text.split('/')
  return [parseDockerSize(first ?? ''), parseDockerSize(second ?? '')]
}

/** `2026-11-16 20:05:54 +0000 UTC` (listings) or RFC 3339 (inspect); Docker's zero time is no time. */
export function parseDockerTime(value: unknown): number | null {
  const match =
    typeof value === 'string'
      ? /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(?:\.(\d+))? ?(Z|[+-]\d\d:?\d\d)?/.exec(value)
      : null
  if (!match || match[1] === '0001-01-01') {
    return null
  }
  const [, date, time, fraction = '', zone = 'Z'] = match
  const offset = zone === 'Z' || zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`
  const parsed = Date.parse(`${date}T${time}.${fraction.padEnd(3, '0').slice(0, 3)}${offset}`)
  return Number.isFinite(parsed) ? parsed : null
}

export type DockerJsonRow = Record<string, unknown>

export function isDockerJsonRow(value: unknown): value is DockerJsonRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The JSON objects on lines starting with `prefix`; a line that is cut short or not JSON is skipped. */
export function dockerJsonRows(lines: readonly string[], prefix: string): DockerJsonRow[] {
  const rows: DockerJsonRow[] = []
  for (const line of lines) {
    if (!line.startsWith(prefix)) {
      continue
    }
    try {
      const parsed: unknown = JSON.parse(line.slice(prefix.length))
      if (isDockerJsonRow(parsed)) {
        rows.push(parsed)
      }
    } catch {
      // Output past the transport's cap ends mid-line.
    }
  }
  return rows
}

export function dockerText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function shortDockerId(id: string): string {
  return id.replace(/^sha256:/, '').slice(0, 12)
}

/** Listings print an id in full or cut to 12 characters, with or without `sha256:`. */
export function sameDockerId(a: string, b: string): boolean {
  const [left, right] = [a.replace(/^sha256:/, ''), b.replace(/^sha256:/, '')]
  return (
    left.length >= 12 && right.length >= 12 && (left.startsWith(right) || right.startsWith(left))
  )
}

export function classifyDockerUnreachable(message: string): MachineDockerUnreachableReason {
  if (/permission denied/i.test(message)) {
    return 'permission'
  }
  return /cannot connect to the docker daemon|is the docker daemon running|if the daemon is running|error during connect|no such file or directory|connection refused/i.test(
    message
  )
    ? 'not-running'
    : 'other'
}

/**
 * Defines `seal_docker_try <command…>`: it leaves the command's output in `$seal_docker_out` and
 * prints `@ready`, or prints `@missing` / `@unreachable <why>` and fails.
 */
export const DOCKER_TRY_FUNCTION = `
seal_docker_first_line() { printf '%s\\n' "$1" | sed -n '/[^[:space:]]/{p;q;}'; }
seal_docker_try() {
  command -v docker >/dev/null 2>&1 || { echo "@missing"; return 1; }
  if ! seal_docker_out=$("$@" 2>&1); then
    printf '@unreachable %s\\n' "$(seal_docker_first_line "$seal_docker_out")"
    return 1
  fi
  echo "@ready"
}
`

/** What `seal_docker_try` reported, or null when Docker answered. */
export function parseDockerUnavailable(lines: readonly string[]): MachineDockerUnavailable | null {
  if (lines.includes('@missing')) {
    return { state: 'missing' }
  }
  const unreachable = lines.find((line) => line.startsWith('@unreachable'))
  if (!unreachable && lines.includes('@ready')) {
    return null
  }
  const message = unreachable?.slice('@unreachable'.length).trim() || 'Docker did not answer.'
  return { state: 'unreachable', reason: classifyDockerUnreachable(message), message }
}

const GONE: Record<string, string> = {
  container: 'This container is no longer on the machine.',
  image: 'This image is no longer on the machine.',
  volume: 'This volume is no longer on the machine.'
}

/** Docker's own first line, or a plain sentence when the object it was asked about is gone. */
export function dockerObjectError(kind: 'container' | 'image' | 'volume', message: string): Error {
  return new Error(/no such (container|image|volume|object)/i.test(message) ? GONE[kind] : message)
}

export function dockerExecError(
  kind: 'container' | 'image' | 'volume',
  result: MachineExecResult
): Error {
  return dockerObjectError(kind, firstErrorLine(result))
}

/** Who uses what: one compact JSON object per container instead of its whole `inspect` document. */
const CONTAINER_USE_FORMAT =
  '{"Id":{{json .Id}},"Name":{{json .Name}},"State":{{json .State.Status}},"Running":{{json .State.Running}},"Image":{{json .Config.Image}},"ImageID":{{json .Image}},"Mounts":{{json .Mounts}}}'

/** Reads container ids on stdin and prints an `@k` row for each. */
export const DOCKER_CONTAINER_USE_COMMAND = `xargs docker container inspect --format '${CONTAINER_USE_FORMAT}' 2>/dev/null | sed 's/^/@k /'`

/** Prints an `@k` row for every container, running or not. */
export const DOCKER_ALL_CONTAINER_USE_COMMAND = `docker ps -aq --no-trunc 2>/dev/null | head -n ${DOCKER_CONTAINER_LIMIT} | ${DOCKER_CONTAINER_USE_COMMAND}`

export type DockerContainerUse = MachineDockerContainerRef & {
  image: string
  imageId: string | null
  mounts: MachineDockerContainerMount[]
}

export function parseDockerMounts(value: unknown): MachineDockerContainerMount[] {
  return (Array.isArray(value) ? value : []).flatMap((mount: unknown) => {
    if (!isDockerJsonRow(mount)) {
      return []
    }
    const fields = mount
    const type = dockerText(fields.Type)
    return [
      {
        type,
        volume: type === 'volume' ? dockerText(fields.Name) || null : null,
        source: dockerText(fields.Source),
        destination: dockerText(fields.Destination),
        readOnly: fields.RW === false
      }
    ]
  })
}

export function parseDockerContainerUses(lines: readonly string[]): DockerContainerUse[] {
  return dockerJsonRows(lines, '@k ').flatMap((row) => {
    const id = dockerText(row.Id)
    return DOCKER_CONTAINER_ID.test(id)
      ? [
          {
            id,
            name: dockerText(row.Name).replace(/^\//, '') || shortDockerId(id),
            state: dockerText(row.State),
            running: row.Running === true,
            image: dockerText(row.Image),
            imageId: dockerText(row.ImageID) || null,
            mounts: parseDockerMounts(row.Mounts)
          }
        ]
      : []
  })
}

export function containerRef(container: MachineDockerContainerRef): MachineDockerContainerRef {
  return {
    id: container.id,
    name: container.name,
    state: container.state,
    running: container.running
  }
}
