import type { MachineDiskIndexProgress } from '../../../shared/machines/machine-disk-index-types'

/** Numbers a running scan shares with the daemon: folders, files, bytes, reused, expected folders, incremental. */
const SCAN_PROGRESS_SLOTS = 6

export type ScanProgressCounters = Float64Array<SharedArrayBuffer>

export function createScanProgress(): ScanProgressCounters {
  const progress = new Float64Array(
    new SharedArrayBuffer(SCAN_PROGRESS_SLOTS * Float64Array.BYTES_PER_ELEMENT)
  )
  progress[4] = -1
  return progress
}

export function writeScanStart(
  progress: ScanProgressCounters,
  expectedFolders: number | null,
  incremental: boolean
): void {
  progress[4] = expectedFolders ?? -1
  progress[5] = incremental ? 1 : 0
}

export function writeScanProgress(
  progress: ScanProgressCounters,
  current: { folders: number; files: number; bytes: number; reused: number }
): void {
  progress[0] = current.folders
  progress[1] = current.files
  progress[2] = current.bytes
  progress[3] = current.reused
}

export function readScanProgress(
  progress: ScanProgressCounters,
  mount: string,
  startedAt: number
): MachineDiskIndexProgress {
  return {
    mount,
    mode: progress[5] === 1 ? 'incremental' : 'full',
    startedAt,
    folders: progress[0],
    files: progress[1],
    bytes: Math.round(progress[2]),
    reusedFolders: progress[3],
    expectedFolders: progress[4] >= 0 ? progress[4] : null
  }
}
