import { lstat, readFile, readdir, statfs } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { MachineDiskIndexSkipReason } from '../../../shared/machines/machine-disk-index-types'
import { isHiddenDiskMount } from '../../../shared/machines/machine-disk-mount-rules'

const LOCAL_FILESYSTEMS = new Set([
  'ext2',
  'ext3',
  'ext4',
  'xfs',
  'btrfs',
  'zfs',
  'f2fs',
  'jfs',
  'reiserfs',
  'bcachefs',
  'nilfs2',
  'ntfs',
  'ntfs3',
  'fuseblk',
  'vfat',
  'exfat',
  'hfsplus',
  'apfs',
  'ufs'
])
const NETWORK_FILESYSTEMS = new Set([
  'nfs',
  'nfs4',
  'cifs',
  'smb3',
  'smbfs',
  '9p',
  'ceph',
  'glusterfs',
  'lustre',
  'afs',
  'davfs',
  'beegfs',
  'virtiofs',
  'fuse.sshfs',
  'fuse.rclone',
  'fuse.s3fs'
])
/** Kernel views with no disk behind them; skipped even when the mount table cannot be read. */
const ALWAYS_STOPPED = ['/proc', '/sys', '/dev', '/run']
/** macOS asks the person before a program may read these, so a background scan stays out. */
const MACOS_PROTECTED_FOLDERS = [
  'Desktop',
  'Documents',
  'Downloads',
  'Library/Mobile Documents',
  'Library/CloudStorage'
]
const MACOS_DATA_VOLUME = '/System/Volumes/Data'

export type DiskIndexRoot = {
  mount: string
  filesystem: string
  fsType: string | null
  totalBytes: number
  usedBytes: number
  availableBytes: number
  /** Why the disk is not walked unless the person asks; null for an ordinary local disk. */
  defaultSkip: MachineDiskIndexSkipReason | null
  stops: string[]
  sameDiskPaths: string[]
  anyDev: boolean
}

export type MountTableEntry = { mount: string; fsType: string; source: string }

function unescapeMountField(field: string): string {
  return field.replace(/\\([0-7]{3})/g, (_, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8))
  )
}

/** `/proc/self/mountinfo`, keeping the mount that is on top at each mount point. */
export function parseMountInfo(text: string): MountTableEntry[] {
  const byMount = new Map<string, MountTableEntry>()
  for (const line of text.split('\n')) {
    const separator = line.indexOf(' - ')
    if (separator === -1) {
      continue
    }
    const mount = line.slice(0, separator).split(' ')[4]
    const [fsType, source] = line.slice(separator + 3).split(' ')
    if (mount && fsType) {
      const path = unescapeMountField(mount)
      byMount.delete(path)
      byMount.set(path, { mount: path, fsType, source: unescapeMountField(source ?? '') })
    }
  }
  return [...byMount.values()]
}

function skipReasonFor(entry: MountTableEntry): MachineDiskIndexSkipReason | null {
  if (LOCAL_FILESYSTEMS.has(entry.fsType) || (entry.fsType === 'overlay' && entry.mount === '/')) {
    return null
  }
  return NETWORK_FILESYSTEMS.has(entry.fsType) || entry.fsType.startsWith('fuse.')
    ? 'network'
    : 'virtual'
}

function isUnder(path: string, root: string): boolean {
  return path !== root && path.startsWith(root === '/' ? '/' : `${root}/`)
}

const STATFS_TIMEOUT_MS = 3000
/** Mounts whose last size request never came back, e.g. a network share whose server is gone. */
const unanswered = new Set<string>()

async function sizesOf(
  mount: string
): Promise<Pick<DiskIndexRoot, 'totalBytes' | 'usedBytes' | 'availableBytes'> | null> {
  if (unanswered.has(mount)) {
    return null
  }
  unanswered.add(mount)
  const request = statfs(mount).finally(() => unanswered.delete(mount))
  let timer: NodeJS.Timeout | undefined
  const stats = await Promise.race([
    request.catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(resolve, STATFS_TIMEOUT_MS, null)
    })
  ])
  clearTimeout(timer)
  if (!stats) {
    return null
  }
  const totalBytes = stats.blocks * stats.bsize
  return totalBytes > 0
    ? {
        totalBytes,
        usedBytes: (stats.blocks - stats.bfree) * stats.bsize,
        availableBytes: stats.bavail * stats.bsize
      }
    : null
}

/** Linux: one root per real filesystem, each stopping at every other mount point beneath it. */
export async function linuxDiskIndexRoots(table: MountTableEntry[]): Promise<DiskIndexRoot[]> {
  const roots: DiskIndexRoot[] = []
  const seen = new Set<string>()
  const shown = table
    .filter((entry) => skipReasonFor(entry) !== 'virtual' && !isHiddenDiskMount(entry.mount))
    .sort((a, b) => a.mount.length - b.mount.length)
  for (const entry of shown) {
    const disk = `${entry.source}\0${entry.fsType}`
    const sizes = seen.has(disk) ? null : await sizesOf(entry.mount)
    if (!sizes) {
      continue
    }
    seen.add(disk)
    // btrfs mounts each subvolume of one disk separately; they belong to the root shown for it.
    const sameDisk = (other: MountTableEntry): boolean =>
      entry.fsType === 'btrfs' && other.fsType === 'btrfs' && other.source === entry.source
    roots.push({
      mount: entry.mount,
      filesystem: entry.source,
      fsType: entry.fsType,
      ...sizes,
      defaultSkip: skipReasonFor(entry),
      stops: [
        ...table
          .filter((other) => isUnder(other.mount, entry.mount) && !sameDisk(other))
          .map((other) => other.mount),
        ...ALWAYS_STOPPED.filter((path) => isUnder(path, entry.mount))
      ],
      sameDiskPaths: [],
      anyDev: entry.fsType === 'btrfs'
    })
  }
  return roots
}

/** macOS: `/` spans the system and data volumes; other volumes are walked only when asked. */
export async function macDiskIndexRoots(includeProtected: boolean): Promise<DiskIndexRoot[]> {
  const roots: DiskIndexRoot[] = []
  const system = await sizesOf('/')
  const systemDev = (await lstat('/')).dev
  const dataDev = await lstat(MACOS_DATA_VOLUME).then(
    (stat) => stat.dev,
    () => systemDev
  )
  if (system) {
    roots.push({
      mount: '/',
      filesystem: '',
      fsType: null,
      totalBytes: system.totalBytes,
      // The volumes share one container, so what is not available is in use by one of them.
      usedBytes: system.totalBytes - system.availableBytes,
      availableBytes: system.availableBytes,
      defaultSkip: null,
      stops: [
        '/System/Volumes',
        '/Volumes',
        '/dev',
        '/private/var/vm',
        ...(includeProtected ? [] : MACOS_PROTECTED_FOLDERS.map((name) => join(homedir(), name)))
      ],
      sameDiskPaths: [MACOS_DATA_VOLUME],
      anyDev: false
    })
  }
  for (const name of await readdir('/Volumes').catch(() => [])) {
    const mount = `/Volumes/${name}`
    const stat = await lstat(mount).catch(() => null)
    if (!stat?.isDirectory() || stat.dev === systemDev || stat.dev === dataDev) {
      continue
    }
    const sizes = await sizesOf(mount)
    if (sizes) {
      roots.push({
        mount,
        filesystem: name,
        fsType: null,
        ...sizes,
        defaultSkip: 'removable',
        stops: [],
        sameDiskPaths: [],
        anyDev: false
      })
    }
  }
  return roots
}

export async function discoverDiskIndexRoots(includeProtected: boolean): Promise<DiskIndexRoot[]> {
  if (process.platform === 'darwin') {
    return macDiskIndexRoots(includeProtected)
  }
  const table = await readFile('/proc/self/mountinfo', 'utf8').then(parseMountInfo, () => null)
  if (table) {
    return linuxDiskIndexRoots(table)
  }
  const sizes = await sizesOf('/')
  return sizes
    ? [
        {
          mount: '/',
          filesystem: '',
          fsType: null,
          ...sizes,
          defaultSkip: null,
          stops: ALWAYS_STOPPED,
          sameDiskPaths: [],
          anyDev: false
        }
      ]
    : []
}

export function isMacProtectedFoldersPlatform(): boolean {
  return process.platform === 'darwin'
}
