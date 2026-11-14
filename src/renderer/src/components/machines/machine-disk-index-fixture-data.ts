import type {
  MachineDiskIndexEntry,
  MachineDiskIndexLargestItem,
  MachineDiskIndexReply,
  MachineDiskIndexRequest,
  MachineDiskIndexStatus
} from '../../../../shared/machines/machine-disk-index-types'

const now = Date.now()
const GB = 1024 ** 3
const TB = 1024 ** 4

const STATUS: MachineDiskIndexStatus = {
  source: 'index',
  unavailableReason: null,
  mounts: [
    {
      mount: '/',
      filesystem: '/dev/nvme0n1p2',
      fsType: 'ext4',
      totalBytes: 4 * TB,
      usedBytes: 2.9 * TB,
      availableBytes: 1.1 * TB,
      indexed: true,
      skipReason: null,
      scannedAt: now - 11 * 60_000,
      scanDurationMs: 41_000,
      scanMode: 'incremental',
      indexedBytes: 2.88 * TB,
      indexedFiles: 18_412_907,
      indexedFolders: 1_904_332,
      unreadableFolders: 14
    },
    {
      mount: '/data',
      filesystem: '/dev/md0',
      fsType: 'xfs',
      totalBytes: 16 * TB,
      usedBytes: 9.6 * TB,
      availableBytes: 6.4 * TB,
      indexed: true,
      skipReason: null,
      scannedAt: now - 26 * 60_000,
      scanDurationMs: 96_000,
      scanMode: 'incremental',
      indexedBytes: 9.6 * TB,
      indexedFiles: 31_077_518,
      indexedFolders: 2_610_044,
      unreadableFolders: 0
    },
    {
      mount: '/mnt/nas',
      filesystem: 'nas.local:/backup',
      fsType: 'nfs4',
      totalBytes: 32 * TB,
      usedBytes: 21 * TB,
      availableBytes: 11 * TB,
      indexed: false,
      skipReason: 'network',
      scannedAt: null,
      scanDurationMs: null,
      scanMode: null,
      indexedBytes: null,
      indexedFiles: null,
      indexedFolders: null,
      unreadableFolders: 0
    }
  ],
  scan: {
    mount: '/data',
    mode: 'incremental',
    startedAt: now - 20_000,
    folders: 1_644_327,
    files: 19_578_836,
    bytes: 6.1 * TB,
    reusedFolders: 1_640_112,
    expectedFolders: 2_610_044
  },
  nextScanAt: now + 19 * 60_000,
  now,
  generation: 7,
  protectedFoldersSkipped: false
}

function entry(
  parent: string,
  name: string,
  kind: MachineDiskIndexEntry['kind'],
  bytes: number | null,
  files: number | null = null,
  extra: Partial<MachineDiskIndexEntry> = {}
): MachineDiskIndexEntry {
  return {
    name,
    path: `${parent}/${name}`,
    kind,
    bytes,
    files,
    mtimeMs: now - 86_400_000,
    notIndexed: false,
    unreadable: false,
    ...extra
  }
}

function largest(path: string, bytes: number, files: number | null): MachineDiskIndexLargestItem {
  return { path, bytes, files, mtimeMs: now - 3 * 86_400_000 }
}

/** A training box whose index is current and is checking its data disk for changes. */
export function fakeDiskIndexReply(
  home: string,
  request: MachineDiskIndexRequest
): MachineDiskIndexReply {
  if (request.op === 'list') {
    const path = request.path
    return {
      ok: true,
      listing: {
        path,
        totalBytes: 1.9 * TB,
        entries: [
          entry(path, 'datasets', 'directory', 1.2 * TB, 9_412_880),
          entry(path, 'checkpoints', 'directory', 640 * GB, 1_204),
          entry(path, '.cache', 'directory', 61 * GB, 388_120),
          entry(path, 'seal', 'directory', 14.2 * GB, 211_907),
          entry(path, 'wandb', 'directory', 9.8 * GB, 40_551),
          entry(path, 'core.41270', 'file', 4.6 * GB),
          entry(path, 'train.log', 'file', 48_210_944),
          entry(path, 'nas', 'directory', null, null, { notIndexed: true }),
          entry(path, 'current', 'symlink', 0)
        ],
        omittedCount: 23,
        omittedBytes: 310 * 1024 ** 2,
        incomplete: false,
        scannedAt: now - 11 * 60_000
      }
    }
  }
  if (request.op === 'largest') {
    return {
      ok: true,
      largest: {
        kind: request.kind,
        scannedAt: now - 11 * 60_000,
        items:
          request.kind === 'files'
            ? [
                largest(`${home}/checkpoints/vit-l-ep90.safetensors`, 118 * GB, null),
                largest(`${home}/checkpoints/vit-l-ep60.safetensors`, 118 * GB, null),
                largest(`${home}/datasets/laion-subset/shard-000.tar`, 96 * GB, null),
                largest('/var/lib/libvirt/images/win11.qcow2', 80 * GB, null),
                largest(`${home}/.cache/huggingface/hub/llama-8b/model.gguf`, 31 * GB, null),
                largest(`${home}/core.41270`, 4.6 * GB, null)
              ]
            : [
                largest(`${home}/checkpoints`, 640 * GB, 1_204),
                largest(`${home}/datasets/laion-subset`, 410 * GB, 4_096),
                largest(`${home}/datasets/imagenet/train`, 142 * GB, 1_281_167),
                largest('/var/lib/libvirt/images', 96 * GB, 3),
                largest(`${home}/.cache/huggingface/hub/llama-8b`, 42 * GB, 11)
              ]
      }
    }
  }
  return { ok: true, status: STATUS }
}

/** A machine whose daemon did not come up: live figures, the failed step and the machine's words. */
export function fakeDiskIndexNotStartedReply(
  home: string,
  request: MachineDiskIndexRequest
): MachineDiskIndexReply {
  if (request.op === 'list' || request.op === 'largest') {
    return fakeDiskIndexReply(home, request)
  }
  return {
    ok: true,
    status: {
      ...STATUS,
      source: 'live',
      unavailableReason: 'daemon-failed',
      unavailableDetail: `listen EACCES: permission denied ${home}/.seal/disk-index/daemon.sock`,
      mounts: STATUS.mounts.map((mount) => ({
        ...mount,
        indexed: false,
        skipReason: null,
        scannedAt: null,
        indexedFiles: null
      })),
      scan: null,
      nextScanAt: null
    }
  }
}
