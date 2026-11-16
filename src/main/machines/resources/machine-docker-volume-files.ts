import { posix } from 'node:path'
import {
  MACHINE_DOCKER_VOLUME_PREVIEW_MAX_BYTES,
  type MachineDockerVolumeListing
} from '../../../shared/machines/machine-docker-types'
import { MACHINE_DIR_PAGE_SIZE, type MachineFileRead } from '../../../shared/machines/machine-types'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { MachineConnection } from '../connection/machine-connection'
import { parsePosixListDirOutput, posixListDirCommand } from '../filesystem/posix-machine-commands'
import {
  DOCKER_ALL_CONTAINER_USE_COMMAND,
  DOCKER_NAME,
  dockerExecError,
  dockerJsonRows,
  dockerObjectError,
  dockerText,
  parseDockerContainerUses,
  parseDockerSize,
  sameDockerId
} from './machine-docker-output'
import { runMachineHostScript } from './machine-host-script'

const VOLUME_TIMEOUT_MS = 60_000
const REMEMBER_ACCESS_MS = 5 * 60_000
const HELPER_ATTEMPTS = 4
const HELPER_ROOT = '/seal-volume'
const VOLUME_NAME = /^[A-Za-z0-9][\w.-]*$/
const READ_BLOCK_BYTES = 64 * 1024
/** One chunk, base64 encoded, has to fit the transport's output cap. */
const READ_CHUNK_BLOCKS = 8
const READ_CHUNK_BYTES = READ_BLOCK_BYTES * READ_CHUNK_BLOCKS

/** How a volume's files are reached: its folder on the machine, or a container from a local image. */
type VolumeAccess = { at: number; root: string | null; images: string[]; user: string }

const accesses = new Map<string, VolumeAccess>()

/** A path inside a volume: absolute, without `.` or `..`; duplicate and trailing slashes are dropped. */
export function normalizeDockerVolumePath(path: string): string {
  const segments = path.split('/').filter(Boolean)
  if (
    !path.startsWith('/') ||
    /[\0\r\n]/.test(path) ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error('This is not a path inside the volume.')
  }
  return `/${segments.join('/')}`
}

function under(root: string, path: string): string {
  return path === '/' ? root : `${root}${path}`
}

// Both scripts print `@volume` once they can work; a link may never lead out of the volume.
function enterVolume(root: string, dir: string, gone: string): string {
  return `
echo "@volume"
seal_root=$(cd ${quotePosixShell(root)} 2>/dev/null && pwd -P) || { echo "@noroot"; exit 0; }
seal_dir=$(cd ${quotePosixShell(dir)} 2>/dev/null && pwd -P) || { [ -d ${quotePosixShell(dir)} ] && echo "@denied" || echo "${gone}"; exit 0; }
case "$seal_dir/" in "$seal_root"/*) ;; *) echo "@outside"; exit 0 ;; esac`
}

function listScript(root: string, path: string): string {
  const dir = under(root, path)
  return `command -v stat >/dev/null 2>&1 || exit 127${enterVolume(root, dir, '@nodir')}
echo "@listing"
${posixListDirCommand(dir)}`
}

function readScript(root: string, path: string, chunk: number): string {
  return `command -v base64 >/dev/null 2>&1 || exit 127${enterVolume(root, under(root, posix.dirname(path)), '@nofile')}
seal_file="$seal_dir"/${quotePosixShell(posix.basename(path))}
if [ -L "$seal_file" ]; then
  seal_file=$(realpath "$seal_file" 2>/dev/null || readlink -f "$seal_file" 2>/dev/null) || { echo "@outside"; exit 0; }
  case "$seal_file" in "$seal_root"/*) ;; *) echo "@outside"; exit 0 ;; esac
fi
[ -e "$seal_file" ] || { echo "@nofile"; exit 0; }
[ -f "$seal_file" ] || { echo "@notfile"; exit 0; }
[ -r "$seal_file" ] || { echo "@denied"; exit 0; }
echo "@size $(stat -c %s -- "$seal_file" 2>/dev/null || stat -f %z -- "$seal_file" 2>/dev/null || wc -c <"$seal_file")"
echo "@data"
dd if="$seal_file" bs=${READ_BLOCK_BYTES} skip=${chunk * READ_CHUNK_BLOCKS} count=${READ_CHUNK_BLOCKS} 2>/dev/null | base64`
}

// A folder can hold more names than one answer may carry.
const KEEP_FIRST_ENTRIES = ` | awk -v max=${MACHINE_DIR_PAGE_SIZE} '/^@/ { print; next } /^L\\// { if (links++ < max) print; next } { if (total++ < max) print } END { print "@total " (total + 0) }'`

function probeScript(volume: string): string {
  return `
seal_mount=$(docker volume inspect --format '{{.Mountpoint}}' ${volume}) || return 1
echo "@user $(id -un 2>/dev/null)"
if [ -n "$seal_mount" ] && [ -r "$seal_mount" ] && [ -x "$seal_mount" ]; then
  printf '@direct %s\\n' "$seal_mount"
  return 0
fi
${DOCKER_ALL_CONTAINER_USE_COMMAND}
docker image ls --no-trunc --format '{{json .}}' 2>/dev/null | head -n 500 | sed 's/^/@g /'
`
}

/** Images to try as a helper: those of the volume's own containers, then the smallest ones. */
export function dockerVolumeHelperImages(volume: string, lines: readonly string[]): string[] {
  const users = parseDockerContainerUses(lines)
    .filter((use) => use.mounts.some((mount) => mount.volume === volume))
    .flatMap((use) => use.imageId ?? [])
  const smallest = dockerJsonRows(lines, '@g ')
    .map((row) => ({ id: dockerText(row.ID), bytes: parseDockerSize(dockerText(row.Size)) }))
    .sort((a, b) => (a.bytes ?? Infinity) - (b.bytes ?? Infinity))
    .map((image) => image.id)
  const images: string[] = []
  for (const id of [...users, ...smallest]) {
    if (DOCKER_NAME.test(id) && !images.some((known) => sameDockerId(known, id))) {
      images.push(id)
    }
  }
  return images.slice(0, HELPER_ATTEMPTS)
}

function accessKey(connection: MachineConnection, volume: string): string {
  return `${connection.machineId}\n${volume}`
}

async function probeVolumeAccess(
  connection: MachineConnection,
  volume: string
): Promise<VolumeAccess> {
  const result = await runMachineHostScript(connection, probeScript(quotePosixShell(volume)), {
    timeoutMs: VOLUME_TIMEOUT_MS
  })
  if (result.exitCode !== 0) {
    throw dockerExecError('volume', result)
  }
  const lines = result.stdout.split(/\r?\n/)
  const marked = (marker: string): string | null =>
    lines.find((line) => line.startsWith(marker))?.slice(marker.length) ?? null
  return {
    at: Date.now(),
    root: marked('@direct '),
    images: dockerVolumeHelperImages(volume, lines),
    user: marked('@user ') || 'this account'
  }
}

function accessScript(
  volume: string,
  access: VolumeAccess,
  script: (root: string) => string,
  filter: string
): string {
  if (access.root !== null) {
    return `sh -c ${quotePosixShell(script(access.root))} 2>/dev/null${filter}`
  }
  // Docker would create a volume that is gone; a helper that cannot start prints no "@volume".
  return `
seal_error=$(docker volume inspect --format '{{.Name}}' ${volume} 2>&1 >/dev/null) || { printf '@error %s\\n' "$(printf '%s\\n' "$seal_error" | sed -n '/[^[:space:]]/{p;q;}')"; return 0; }
for seal_image in ${access.images.map(quotePosixShell).join(' ')}; do
  seal_out=$(docker run --rm --pull never --network none --read-only --user 0:0 --security-opt label=disable --entrypoint sh -v ${volume}:${HELPER_ROOT}:ro "$seal_image" -c ${quotePosixShell(script(HELPER_ROOT))} 2>/dev/null${filter})
  case "$seal_out" in "@volume"*) printf '@image %s\\n%s\\n' "$seal_image" "$seal_out"; return 0 ;; esac
done
`
}

const REFUSALS: Record<string, string> = {
  '@outside': 'This link points outside the volume.',
  '@nodir': 'This folder is not in the volume.',
  '@nofile': 'This file is not in the volume.',
  '@notfile': 'Only regular files can be previewed.',
  '@denied': 'This account may not read this part of the volume.'
}

/** Runs a read-only script against the volume's files and returns the lines it printed. */
async function runInVolume(
  connection: MachineConnection,
  volume: string,
  script: (root: string) => string,
  filter = ''
): Promise<string[]> {
  if (!VOLUME_NAME.test(volume)) {
    throw new Error('Unknown volume')
  }
  const key = accessKey(connection, volume)
  let access = accesses.get(key)
  let remembered = access !== undefined && Date.now() - access.at < REMEMBER_ACCESS_MS
  for (;;) {
    if (!access || !remembered) {
      access = await probeVolumeAccess(connection, volume)
      accesses.set(key, access)
    }
    const result = await runMachineHostScript(
      connection,
      accessScript(quotePosixShell(volume), access, script, filter),
      { timeoutMs: VOLUME_TIMEOUT_MS }
    )
    const lines = result.stdout.split(/\r?\n/)
    const error = lines.find((line) => line.startsWith('@error '))
    if (error) {
      accesses.delete(key)
      throw dockerObjectError('volume', error.slice('@error '.length))
    }
    if (lines.includes('@volume') && !lines.includes('@noroot')) {
      const image = lines.find((line) => line.startsWith('@image '))?.slice('@image '.length)
      if (image) {
        access.images = [image]
      }
      const refusal = lines.find((line) => Object.hasOwn(REFUSALS, line))
      if (refusal) {
        throw new Error(REFUSALS[refusal])
      }
      return lines
    }
    accesses.delete(key)
    if (!remembered) {
      throw new Error(
        `Seal cannot read this volume's folder as ${access.user}, and no local image can run a helper container to read it.`
      )
    }
    // What worked a while ago may be gone: look at the machine again, once.
    remembered = false
  }
}

export async function listMachineDockerVolumeDir(
  connection: MachineConnection,
  volume: string,
  path: string
): Promise<MachineDockerVolumeListing> {
  const dir = normalizeDockerVolumePath(path)
  const lines = await runInVolume(
    connection,
    volume,
    (root) => listScript(root, dir),
    KEEP_FIRST_ENTRIES
  )
  const entries = parsePosixListDirOutput(lines.slice(lines.indexOf('@listing') + 1).join('\n'))
  const total = lines.find((line) => line.startsWith('@total '))?.slice('@total '.length)
  return { path: dir, entries, totalEntries: Math.max(Number(total) || 0, entries.length) }
}

export async function readMachineDockerVolumeFile(
  connection: MachineConnection,
  volume: string,
  path: string
): Promise<MachineFileRead> {
  const file = normalizeDockerVolumePath(path)
  if (file === '/') {
    throw new Error(REFUSALS['@notfile'])
  }
  const chunks: Buffer[] = []
  let size = 0
  for (let chunk = 0; chunk * READ_CHUNK_BYTES < MACHINE_DOCKER_VOLUME_PREVIEW_MAX_BYTES; chunk++) {
    const lines = await runInVolume(connection, volume, (root) => readScript(root, file, chunk))
    size = Number(lines.find((line) => line.startsWith('@size '))?.slice('@size '.length)) || 0
    const data = Buffer.from(lines.slice(lines.indexOf('@data') + 1).join(''), 'base64')
    chunks.push(data)
    if (data.length < READ_CHUNK_BYTES || (chunk + 1) * READ_CHUNK_BYTES >= size) {
      break
    }
  }
  const data = Buffer.concat(chunks).subarray(0, MACHINE_DOCKER_VOLUME_PREVIEW_MAX_BYTES)
  return {
    path: file,
    size: Math.max(size, data.length),
    contentBase64: data.toString('base64'),
    truncated: size > data.length
  }
}
