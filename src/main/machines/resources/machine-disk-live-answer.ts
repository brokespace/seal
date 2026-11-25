import type {
  MachineDiskIndexReply,
  MachineDiskIndexRequest,
  MachineDiskIndexUnavailableReason
} from '../../../shared/machines/machine-disk-index-types'
import type { MachineConnection } from '../connection/machine-connection'
import { listMachineDiskMounts, measureMachineDiskUsage } from './machine-disk-usage'

/** The step that kept a machine's index from answering, and what was said when it failed. */
export type DiskIndexFailure = {
  reason: MachineDiskIndexUnavailableReason
  detail: string | null
}

/** Sizes measured on demand with `df` and `du`, for a machine that cannot run the index. */
export async function answerDiskRequestLive(
  connection: MachineConnection,
  request: MachineDiskIndexRequest,
  failure: DiskIndexFailure,
  signal?: AbortSignal
): Promise<MachineDiskIndexReply> {
  if (request.op === 'list') {
    const usage = await measureMachineDiskUsage(connection, request.path, signal)
    return {
      ok: true,
      listing: {
        path: usage.path,
        totalBytes: usage.totalBytes,
        entries: usage.entries.map((entry) => ({
          ...entry,
          files: null,
          mtimeMs: null,
          notIndexed: false,
          unreadable: false
        })),
        omittedCount: usage.omittedCount,
        omittedBytes: usage.omittedBytes,
        incomplete: usage.incomplete,
        scannedAt: null
      }
    }
  }
  if (request.op === 'largest') {
    return { ok: true, largest: { kind: request.kind, items: [], scannedAt: null } }
  }
  const mounts = await listMachineDiskMounts(connection)
  return {
    ok: true,
    status: {
      source: 'live',
      unavailableReason: failure.reason,
      unavailableDetail: failure.detail,
      mounts: mounts.map((mount) => ({
        ...mount,
        fsType: null,
        indexed: false,
        skipReason: null,
        scannedAt: null,
        scanDurationMs: null,
        scanMode: null,
        indexedBytes: null,
        indexedFiles: null,
        indexedFolders: null,
        unreadableFolders: 0
      })),
      scan: null,
      nextScanAt: null,
      now: Date.now(),
      generation: 0,
      protectedFoldersSkipped: false
    }
  }
}
