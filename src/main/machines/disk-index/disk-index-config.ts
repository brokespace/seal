import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  MachineDiskIndexMount,
  MachineDiskIndexSkipReason
} from '../../../shared/machines/machine-disk-index-types'
import type { DiskIndexSummary } from './disk-index-layout'
import type { DiskIndexRoot } from './disk-index-mounts'

/** What the person changed from the defaults: disks added to or left out of the index. */
export type DiskIndexConfig = { include: string[]; exclude: string[]; includeProtected: boolean }

function configPath(dataDir: string): string {
  return join(dataDir, 'config.json')
}

export async function loadDiskIndexConfig(dataDir: string): Promise<DiskIndexConfig> {
  const stored: Partial<DiskIndexConfig> = await readFile(configPath(dataDir), 'utf8').then(
    (text): Partial<DiskIndexConfig> => JSON.parse(text),
    (): Partial<DiskIndexConfig> => ({})
  )
  return {
    include: Array.isArray(stored.include) ? stored.include : [],
    exclude: Array.isArray(stored.exclude) ? stored.exclude : [],
    includeProtected: stored.includeProtected === true
  }
}

export function saveDiskIndexConfig(dataDir: string, config: DiskIndexConfig): Promise<void> {
  return writeFile(configPath(dataDir), JSON.stringify(config), { mode: 0o600 })
}

export function diskIndexSkipReason(
  config: DiskIndexConfig,
  root: DiskIndexRoot
): MachineDiskIndexSkipReason | null {
  if (config.exclude.includes(root.mount)) {
    return 'excluded'
  }
  return config.include.includes(root.mount) ? null : root.defaultSkip
}

/** Records the person's choice for one disk, keeping only choices that differ from the default. */
export function setDiskIndexed(
  config: DiskIndexConfig,
  root: DiskIndexRoot,
  indexed: boolean
): void {
  config.include = config.include.filter((entry) => entry !== root.mount)
  config.exclude = config.exclude.filter((entry) => entry !== root.mount)
  if (indexed && root.defaultSkip) {
    config.include.push(root.mount)
  } else if (!indexed && !root.defaultSkip) {
    config.exclude.push(root.mount)
  }
}

/** One disk as the panel shows it: its capacity, whether it is indexed, and its last scan. */
export function diskIndexMountStatus(
  config: DiskIndexConfig,
  root: DiskIndexRoot,
  summary: DiskIndexSummary | undefined
): MachineDiskIndexMount {
  const skipReason = diskIndexSkipReason(config, root)
  return {
    mount: root.mount,
    filesystem: root.filesystem,
    fsType: root.fsType,
    totalBytes: root.totalBytes,
    usedBytes: root.usedBytes,
    availableBytes: root.availableBytes,
    indexed: skipReason === null,
    skipReason,
    scannedAt: summary?.scannedAt ?? null,
    scanDurationMs: summary?.durationMs ?? null,
    scanMode: summary?.mode ?? null,
    indexedBytes: summary ? Math.round(summary.totalBytes) : null,
    indexedFiles: summary?.totalFiles ?? null,
    indexedFolders: summary?.nodeCount ?? null,
    unreadableFolders: summary?.unreadableFolders ?? 0
  }
}
