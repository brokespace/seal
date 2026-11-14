import type {
  MachineDiskMount,
  MachineDiskUsage,
  MachineDiskUsageEntry
} from '../../../shared/machines/machine-resource-types'
import { machinePathBasename } from '../../../shared/machines/machine-paths'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { MachineConnection } from '../connection/machine-connection'
import { runMachineHostScript } from './machine-host-script'

const MOUNTS_TIMEOUT_MS = 20_000
/** Sizing a large tree walks every file in it. */
const USAGE_TIMEOUT_MS = 10 * 60_000
const MAX_USAGE_ENTRIES = 300

const PSEUDO_FILESYSTEMS = new Set([
  'tmpfs',
  'devtmpfs',
  'udev',
  'devfs',
  'none',
  'shm',
  'run',
  'efivarfs'
])
const HIDDEN_MOUNT_PREFIXES = [
  '/dev',
  '/run',
  '/sys',
  '/proc',
  '/snap/',
  '/var/snap/',
  '/boot/efi',
  '/var/lib/docker/',
  '/var/lib/kubelet/',
  '/private/var/vm'
]

function isBrowsableMount(mount: MachineDiskMount): boolean {
  if (mount.totalBytes <= 0 || PSEUDO_FILESYSTEMS.has(mount.filesystem)) {
    return false
  }
  if (mount.filesystem.startsWith('map ') || mount.filesystem === 'overlay') {
    return mount.mount === '/'
  }
  if (mount.mount.startsWith('/System/Volumes/')) {
    return false
  }
  return !HIDDEN_MOUNT_PREFIXES.some(
    (prefix) => mount.mount === prefix.replace(/\/$/, '') || mount.mount.startsWith(prefix)
  )
}

/** `df -Pk` rows a person would recognise as a disk, one per filesystem. */
export function parseDiskMounts(output: string): MachineDiskMount[] {
  const seen = new Set<string>()
  const mounts: MachineDiskMount[] = []
  let sharedContainerBytes: number | null = null
  for (const line of output.split(/\r?\n/)) {
    const match = /^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/.exec(line)
    if (!match) {
      continue
    }
    const mount: MachineDiskMount = {
      filesystem: match[1],
      mount: match[5],
      totalBytes: Number(match[2]) * 1024,
      usedBytes: Number(match[3]) * 1024,
      availableBytes: Number(match[4]) * 1024
    }
    // macOS keeps user files on a sibling volume of `/`, so `/` alone under-reports the disk.
    if (mount.mount === '/System/Volumes/Data') {
      sharedContainerBytes = mount.totalBytes
    }
    const key = `${mount.filesystem}\0${mount.totalBytes}`
    if (isBrowsableMount(mount) && !seen.has(key)) {
      seen.add(key)
      mounts.push(mount)
    }
  }
  return mounts.map((mount) =>
    mount.mount === '/' && mount.totalBytes === sharedContainerBytes
      ? { ...mount, usedBytes: mount.totalBytes - mount.availableBytes }
      : mount
  )
}

export async function listMachineDiskMounts(
  connection: MachineConnection
): Promise<MachineDiskMount[]> {
  const result = await runMachineHostScript(connection, 'df -Pk 2>/dev/null', {
    timeoutMs: MOUNTS_TIMEOUT_MS
  })
  return parseDiskMounts(result.stdout)
}

// BSD `du` rejects -a with -d, so each child is sized on its own; `find -exec … +` batches them.
function diskUsageScript(path: string): string {
  return `
p=${quotePosixShell(path)}
[ -d "$p" ] || { echo "@notdir"; return 0; }
tab=$(printf '\\t')
errors="\${TMPDIR:-/tmp}/.seal-du-errors.$$"
find "$p" -mindepth 1 -maxdepth 1 -exec du -sk -x -- {} + 2>"$errors" | sort -rn | awk -F"$tab" -v max=${MAX_USAGE_ENTRIES} '
  { n++; total += $1; if (n <= max) print; else { more++; morekb += $1 } }
  END { printf "@sum\\t%d\\t%d\\t%d\\t%d\\n", n, total, more, morekb }' | while IFS= read -r line; do
  case "$line" in "@sum"*) printf '%s\\n' "$line"; continue ;; esac
  kb=\${line%%"$tab"*}
  child=\${line#*"$tab"}
  if [ -L "$child" ]; then kind=l; elif [ -d "$child" ]; then kind=d; else kind=f; fi
  printf '@e\\t%s\\t%s\\t%s\\n' "$kind" "$kb" "$child"
done
[ -s "$errors" ] && echo "@incomplete"
rm -f "$errors"
`
}

const ENTRY_KIND: Record<string, MachineDiskUsageEntry['kind']> = {
  d: 'directory',
  f: 'file',
  l: 'symlink'
}

export function parseDiskUsage(path: string, output: string): MachineDiskUsage {
  const usage: MachineDiskUsage = {
    path,
    totalBytes: 0,
    entries: [],
    omittedCount: 0,
    omittedBytes: 0,
    incomplete: false
  }
  for (const line of output.split(/\r?\n/)) {
    const fields = line.split('\t')
    if (fields[0] === '@e' && fields.length >= 4) {
      const child = fields.slice(3).join('\t')
      usage.entries.push({
        path: child,
        name: machinePathBasename(child),
        kind: ENTRY_KIND[fields[1]] ?? 'file',
        bytes: Number(fields[2]) * 1024
      })
    } else if (fields[0] === '@sum') {
      usage.totalBytes = Number(fields[2]) * 1024
      usage.omittedCount = Number(fields[3])
      usage.omittedBytes = Number(fields[4]) * 1024
    } else if (line === '@incomplete') {
      usage.incomplete = true
    } else if (line === '@notdir') {
      throw new Error('That folder no longer exists on this machine.')
    }
  }
  return usage
}

/** What is taking space directly under `path`, largest first. */
export async function measureMachineDiskUsage(
  connection: MachineConnection,
  path: string,
  signal?: AbortSignal
): Promise<MachineDiskUsage> {
  if (!path.startsWith('/')) {
    throw new Error('An absolute folder path is required')
  }
  const result = await runMachineHostScript(connection, diskUsageScript(path), {
    timeoutMs: USAGE_TIMEOUT_MS,
    ...(signal ? { signal } : {})
  })
  return parseDiskUsage(path, result.stdout)
}
