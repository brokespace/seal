import type { MachinesApi } from '../../../../preload/api/machines/machines-bridge'
import type {
  MachineCleanupItem,
  MachineCleanupTargetId,
  MachineProcess
} from '../../../../shared/machines/machine-resource-types'
import type { MachineGpu } from '../../../../shared/machines/machine-gpu-types'
import type { MachineFileEntry, MachineId } from '../../../../shared/machines/machine-types'
import { WINDOWS_SETUP_NOT_SET_UP } from './machine-cpu-temperature-fixture-data'
import { fakeDiskIndexReply } from './machine-disk-index-fixture-data'
import { fakeMachineDockerApi } from './machine-docker-fixture-data'
import { fakeGpuSnapshot, GPU_PROCESSES } from './machine-gpu-fixture-data'

const now = Date.now()
const GB = 1024 ** 3

function cleanupItem(
  id: string,
  label: string,
  group: string | null,
  bytes: number,
  preselected: boolean
): MachineCleanupItem {
  return { id, label, group, bytes, modifiedAt: now, preselected }
}

const CLEANUP_ITEMS: Partial<Record<MachineCleanupTargetId, MachineCleanupItem[]>> = {
  'package-caches': [
    cleanupItem('package-caches:0', '/home/brian/.npm/_cacache', 'npm', 3.2 * GB, true)
  ],
  'docker-containers': [
    cleanupItem(
      'docker-containers:0',
      'eval-run-0412',
      'seal/eval:2026.04 · exited',
      1.9 * GB,
      false
    )
  ],
  'docker-dangling-images': [
    cleanupItem('docker-dangling-images:0', '9f1c2ab04e77', null, 7.4 * GB, true),
    cleanupItem('docker-dangling-images:1', '51d0a6c3be19', null, 5.1 * GB, true)
  ],
  'docker-images': [
    cleanupItem('docker-images:0', 'nvidia/cuda:12.4.1-devel', null, 18.5 * GB, false),
    cleanupItem('docker-images:1', '9f1c2ab04e77', null, 7.4 * GB, false),
    cleanupItem('docker-images:2', '51d0a6c3be19', null, 5.1 * GB, false)
  ],
  'docker-volumes': [cleanupItem('docker-volumes:0', 'mlflow-artifacts', null, 18 * GB, false)],
  'docker-build-cache': [
    cleanupItem('docker-build-cache:0', 'docker builder prune --all', null, 44 * GB, true)
  ]
}

function fakeProcess(
  pid: number,
  name: string,
  command: string,
  cpuPercent: number,
  rssBytes: number,
  extra: Partial<MachineProcess> = {}
): MachineProcess {
  return {
    pid,
    ppid: 1,
    user: 'brian',
    name,
    command,
    cpuPercent,
    memPercent: (rssBytes / (128 * 1024 ** 3)) * 100,
    rssBytes,
    startMarker: `t${pid}`,
    tmuxPane: null,
    agent: null,
    carriesSealConnection: false,
    ...extra
  }
}

const PROCESSES: MachineProcess[] = [
  fakeProcess(4127, 'python', 'python train.py --config configs/vit-l.yaml', 380.4, 41e9, {
    tmuxPane: 'train:0.0'
  }),
  fakeProcess(5310, 'claude', 'claude --resume', 14.2, 620e6, { agent: 'claude' }),
  fakeProcess(988, 'dockerd', '/usr/bin/dockerd -H fd://', 3.1, 210e6, { user: 'root' }),
  fakeProcess(2201, 'sshd', 'sshd: brian@notty', 0.2, 9e6, { carriesSealConnection: true })
]

type MachineResourceApi = Pick<
  MachinesApi,
  | 'listProcesses'
  | 'signalProcess'
  | 'cpuTemperatureSetup'
  | 'runCpuTemperatureSetup'
  | 'listDockerContainers'
  | 'dockerContainerAction'
  | 'dockerStorage'
  | 'dockerDetails'
  | 'dockerContainerLogs'
  | 'dockerVolumeListDir'
  | 'dockerVolumeReadFile'
  | 'planDockerRemoval'
  | 'onCleanupProgress'
  | 'diskIndex'
  | 'scanCleanup'
  | 'runCleanup'
  | 'completeFolder'
  | 'openFolder'
  | 'recentFolders'
>

/** A busy training box: enough for every resource detail and the folder input to have content. */
export function fakeMachineResourceApi(
  home: string,
  homeEntries: readonly MachineFileEntry[],
  gpusOf: (machineId: MachineId) => MachineGpu[] = () => []
): MachineResourceApi {
  return {
    listProcesses: async ({ machineId, gpus }) => ({
      processes: gpus ? [...GPU_PROCESSES, ...PROCESSES.slice(1)] : PROCESSES,
      ...(gpus ? { gpu: fakeGpuSnapshot(gpusOf(machineId)) } : {}),
      tmuxPanes: [
        { pane: 'train:0.0', pid: 4100, cpuPercent: 381.2, rssBytes: 42e9, processCount: 6 }
      ],
      totalProcesses: 412,
      cpuBusyPercent: 82.4,
      swap: { totalBytes: 8 * 1024 ** 3, usedBytes: 1.5 * 1024 ** 3 },
      collectedAt: Date.now()
    }),
    signalProcess: async () => ({ outcome: 'sent' }),
    cpuTemperatureSetup: async () => WINDOWS_SETUP_NOT_SET_UP,
    runCpuTemperatureSetup: async () => ({
      outcome: 'done',
      detail: null,
      setup: { ...WINDOWS_SETUP_NOT_SET_UP, state: 'running' }
    }),
    ...fakeMachineDockerApi,
    diskIndex: async ({ request }) => fakeDiskIndexReply(home, request),
    scanCleanup: async ({ machineId, target }) => ({
      machineId,
      target,
      token: target,
      items: CLEANUP_ITEMS[target] ?? [],
      totalBytes: (CLEANUP_ITEMS[target] ?? []).reduce((sum, item) => sum + (item.bytes ?? 0), 0),
      omittedCount: 0,
      unavailable: null
    }),
    runCleanup: async ({ itemIds }) => ({ removedIds: itemIds, freedBytes: 0, failures: [] }),
    completeFolder: async ({ input }) => ({
      parent: home,
      matches: homeEntries
        .filter(
          (entry) => entry.isDirectoryLike && entry.name.startsWith(input.split('/').pop() ?? '')
        )
        .map((entry) => ({ name: entry.name, path: `${home}/${entry.name}` })),
      truncated: false
    }),
    openFolder: async ({ input }) => ({ ok: true, path: input.replace(/^~/, home) }),
    recentFolders: async () => [`${home}/seal`, `${home}/datasets`]
  }
}
