import type { MachinesApi } from '../../../../preload/api/machines/machines-bridge'
import type { MachineProcess } from '../../../../shared/machines/machine-resource-types'
import type { MachineFileEntry } from '../../../../shared/machines/machine-types'

const now = Date.now()

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
  | 'listDockerContainers'
  | 'dockerContainerAction'
  | 'listDiskMounts'
  | 'measureDiskUsage'
  | 'scanCleanup'
  | 'runCleanup'
  | 'completeFolder'
  | 'openFolder'
  | 'recentFolders'
>

/** A busy training box: enough for every resource detail and the folder input to have content. */
export function fakeMachineResourceApi(
  home: string,
  homeEntries: readonly MachineFileEntry[]
): MachineResourceApi {
  const npmCache = `${home}/.npm/_cacache`
  return {
    listProcesses: async () => ({
      processes: PROCESSES,
      tmuxPanes: [
        { pane: 'train:0.0', pid: 4100, cpuPercent: 381.2, rssBytes: 42e9, processCount: 6 }
      ],
      totalProcesses: 412,
      cpuBusyPercent: 82.4,
      swap: { totalBytes: 8 * 1024 ** 3, usedBytes: 1.5 * 1024 ** 3 },
      collectedAt: now
    }),
    signalProcess: async () => ({ outcome: 'sent' }),
    listDockerContainers: async () => ({
      state: 'ready',
      containers: [
        {
          id: '1c2d3e4f5a6b',
          name: 'postgres',
          image: 'postgres:16',
          status: 'Up 3 days',
          running: true,
          memUsageBytes: 1.5 * 1024 ** 3,
          memLimitBytes: 4 * 1024 ** 3,
          memPercent: 37.5,
          cpuPercent: 2.1
        }
      ]
    }),
    dockerContainerAction: async () => {},
    listDiskMounts: async () => [
      {
        filesystem: '/dev/nvme0n1p2',
        mount: '/',
        totalBytes: 4 * 1024 ** 4,
        usedBytes: 2.9 * 1024 ** 4,
        availableBytes: 1.1 * 1024 ** 4
      }
    ],
    measureDiskUsage: async ({ path }) => ({
      path,
      totalBytes: 1.9 * 1024 ** 4,
      entries: [
        { path: `${path}/datasets`, name: 'datasets', kind: 'directory', bytes: 1.2 * 1024 ** 4 },
        {
          path: `${path}/checkpoints`,
          name: 'checkpoints',
          kind: 'directory',
          bytes: 640 * 1024 ** 3
        },
        { path: `${path}/train.log`, name: 'train.log', kind: 'file', bytes: 48_210_944 }
      ],
      omittedCount: 0,
      omittedBytes: 0,
      incomplete: false
    }),
    scanCleanup: async ({ machineId, target }) => ({
      machineId,
      target,
      token: target,
      items:
        target === 'package-caches'
          ? [
              {
                id: 'package-caches:0',
                label: npmCache,
                group: 'npm',
                bytes: 3.2 * 1024 ** 3,
                modifiedAt: now,
                preselected: true
              }
            ]
          : [],
      totalBytes: target === 'package-caches' ? 3.2 * 1024 ** 3 : 0,
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
