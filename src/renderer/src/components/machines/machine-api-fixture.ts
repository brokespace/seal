import { toMachineId } from '../../../../shared/machines/machine-types'
import type { MachineView } from '../../../../shared/machines/machine-view'
import type {
  MachineFileEntry,
  MachineMetrics,
  MachineTransfer
} from '../../../../shared/machines/machine-types'
import type { MachinesApi } from '../../../../preload/api/machines/machines-bridge'
import {
  APPLE_SMC,
  THREADRIPPER_K10TEMP,
  XEON_CORETEMP
} from './machine-cpu-temperature-fixture-data'
import { A100_80GB, APPLE_GPU, fakeGpus, RTX_4090 } from './machine-gpu-fixture-data'
import { fakeMachineResourceApi } from './machine-resource-fixture-data'

export const GPU = 'gpu-box'
export const NAS = 'nas'
export const KESSEL = 'kessel-ml'
export const HOME = '/home/brian'
export const now = Date.now()

function dir(name: string): MachineFileEntry {
  return { name, kind: 'directory', isDirectoryLike: true, size: 0, mtimeMs: now - 3_600_000 }
}

function file(name: string, size: number, ageMs = 86_400_000): MachineFileEntry {
  return { name, kind: 'file', isDirectoryLike: false, size, mtimeMs: now - ageMs }
}

const TREE: Record<string, MachineFileEntry[]> = {
  [HOME]: [
    dir('.cache'),
    dir('checkpoints'),
    dir('datasets'),
    dir('seal'),
    file('.bashrc', 3_771),
    file('README.md', 1_204, 600_000),
    file('train.log', 48_210_944, 30_000),
    file('loss-curve.png', 284_113)
  ],
  [`${HOME}/seal`]: [
    dir('src'),
    dir('docs'),
    file('package.json', 4_096),
    file('tsconfig.json', 812)
  ],
  [`${HOME}/datasets`]: [dir('imagenet-mini'), file('manifest.csv', 9_813_220)]
}

const README = `# gpu-box

Training rig for the **Seal** agents.

- 2x RTX 4090, 128 GB RAM
- Checkpoints sync nightly to \`nas:/backup\`
`

function drawLossCurve(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 400
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 640, 400)
    ctx.strokeStyle = '#e5e7eb'
    for (let y = 50; y < 400; y += 50) {
      ctx.beginPath()
      ctx.moveTo(40, y)
      ctx.lineTo(620, y)
      ctx.stroke()
    }
    const series: [string, number][] = [
      ['#2563eb', 0.9],
      ['#f97316', 0.75]
    ]
    for (const [color, scale] of series) {
      ctx.strokeStyle = color
      ctx.lineWidth = 3
      ctx.beginPath()
      for (let x = 0; x <= 580; x += 4) {
        const loss = Math.exp(-x / 140) * 300 * scale + 40 + Math.sin(x / 9) * 6
        ctx.lineTo(40 + x, 380 - loss)
      }
      ctx.stroke()
    }
  }
  return canvas.toDataURL('image/png').split(',')[1] ?? ''
}

function metrics(overrides: Partial<MachineMetrics>): MachineMetrics {
  return {
    hostname: null,
    os: 'linux',
    osRelease: null,
    arch: 'x86_64',
    cpuCount: 8,
    cpuModel: null,
    loadAverage: [1, 1, 1],
    cpuUsagePercent: null,
    memTotalBytes: 32 * 1024 ** 3,
    memAvailableBytes: 16 * 1024 ** 3,
    diskTotalBytes: 1024 ** 4,
    diskAvailableBytes: 512 * 1024 ** 3,
    diskMount: '/',
    uptimeSeconds: 86_400,
    homeDir: HOME,
    collectedAt: now,
    ...overrides
  }
}

export const METRICS: Record<string, MachineMetrics> = {
  local: metrics({
    hostname: 'brians-mbp',
    os: 'darwin',
    osRelease: 'macOS 15.1',
    arch: 'arm64',
    cpuCount: 12,
    loadAverage: [2.1, 1.8, 1.6],
    cpuUsagePercent: null,
    homeDir: '/Users/brian',
    gpus: [APPLE_GPU],
    cpuTemperature: APPLE_SMC
  }),
  [toMachineId(GPU)]: metrics({
    hostname: 'gpu-box',
    osRelease: 'Ubuntu 24.04.1 LTS',
    cpuCount: 32,
    cpuModel: 'AMD Ryzen Threadripper 7970X',
    loadAverage: [26.4, 22.1, 18.9],
    cpuUsagePercent: null,
    memTotalBytes: 128 * 1024 ** 3,
    memAvailableBytes: 22 * 1024 ** 3,
    diskTotalBytes: 4 * 1024 ** 4,
    diskAvailableBytes: 1.1 * 1024 ** 4,
    uptimeSeconds: 1_209_600,
    gpus: fakeGpus(RTX_4090, 2),
    cpuTemperature: THREADRIPPER_K10TEMP
  }),
  [toMachineId(KESSEL)]: metrics({
    hostname: 'kessel-ml',
    osRelease: 'Ubuntu 22.04.5 LTS',
    cpuCount: 24,
    cpuModel: 'Intel Xeon w5-3435X',
    loadAverage: [9.8, 8.4, 7.9],
    memTotalBytes: 256 * 1024 ** 3,
    memAvailableBytes: 141 * 1024 ** 3,
    diskTotalBytes: 8 * 1024 ** 4,
    diskAvailableBytes: 5.2 * 1024 ** 4,
    uptimeSeconds: 432_000,
    gpus: fakeGpus(A100_80GB, 8),
    cpuTemperature: XEON_CORETEMP
  })
}

const TRANSFERS: MachineTransfer[] = [
  {
    id: 't1',
    machineId: toMachineId(GPU),
    direction: 'upload',
    label: 'imagenet-mini',
    destination: `${HOME}/datasets`,
    totalBytes: 3_400_000_000,
    transferredBytes: 2_150_000_000,
    filesTotal: 1_200,
    filesDone: 758,
    status: 'running',
    error: null,
    startedAt: now - 60_000,
    finishedAt: null
  },
  {
    id: 't2',
    machineId: toMachineId(GPU),
    direction: 'url-download',
    label: 'resnet50.safetensors',
    destination: `${HOME}/checkpoints`,
    totalBytes: 102_000_000,
    transferredBytes: 102_000_000,
    filesTotal: 1,
    filesDone: 1,
    status: 'done',
    error: null,
    startedAt: now - 300_000,
    finishedAt: now - 240_000
  }
]

TRANSFERS.unshift({
  id: 't0',
  machineId: toMachineId(KESSEL),
  direction: 'upload',
  label: 'llama-8b-q4.gguf',
  destination: `${HOME}/checkpoints`,
  totalBytes: 4_900_000_000,
  transferredBytes: 1_720_000_000,
  filesTotal: 1,
  filesDone: 0,
  status: 'running',
  error: null,
  startedAt: now - 45_000,
  finishedAt: null
})

export const fakeMachinesApi: MachinesApi = {
  getMetrics: async ({ machineId }) => {
    const entry = METRICS[machineId]
    if (!entry) {
      throw new Error('offline')
    }
    return entry
  },
  listDir: async ({ machineId, path = HOME }) => {
    const entries = TREE[path] ?? []
    return {
      machineId,
      path,
      entries,
      totalEntries: entries.length,
      offset: 0,
      listedAt: now,
      fromCache: false
    }
  },
  watchDirs: async () => {},
  readFile: async ({ path }) => {
    const contentBase64 = path.endsWith('.png') ? drawLossCurve() : btoa(README)
    return { path, size: contentBase64.length, contentBase64, truncated: false }
  },
  writeFile: async () => {},
  createDir: async () => {},
  rename: async () => {},
  remove: async () => {},
  upload: async () => TRANSFERS[0]!,
  download: async () => null,
  downloadUrl: async () => TRANSFERS[1]!,
  cancelTransfer: async () => {},
  listTransfers: async () => TRANSFERS,
  clearFinishedTransfers: async () => {},
  startDrag: () => {},
  onTransferUpdated: () => () => {},
  onDirChanged: () => () => {},
  list: async () => MACHINES,
  onChanged: () => () => {},
  setConnection: async ({ machineId }) => machineView(machineId),
  renameMachine: async ({ machineId }) => machineView(machineId),
  adopt: async () => MACHINES[0]!,
  installServer: async ({ machineId }) => machineView(machineId),
  declineServerInstall: async ({ machineId }) => machineView(machineId),
  removeServer: async ({ machineId }) => machineView(machineId),
  reuseOwnServer: async ({ machineId }) => machineView(machineId),
  separate: async () => MACHINES,
  connect: async () => {},
  shellOpen: async () => ({ ok: false, message: 'Fixture has no shell' }),
  shellWrite: async () => {},
  shellResize: async () => {},
  shellClose: async () => {},
  onShellEvent: () => () => {},
  detectCommands: async () => ['claude', 'codex'],
  listWorktrees: async () => [],
  createWorktree: async () => [],
  removeWorktree: async () => [],
  ...fakeMachineResourceApi(HOME, TREE[HOME] ?? [], (machineId) => METRICS[machineId]?.gpus ?? [])
}

function sshDetails(targetId: string, host: string, port: number, username: string) {
  return {
    targetId,
    address: `${username}@${host}${port === 22 ? '' : `:${port}`}`,
    host,
    username,
    port,
    identityFile: null,
    jumpHost: null
  }
}

const MACHINES: MachineView[] = [
  {
    id: toMachineId(GPU),
    recordId: GPU,
    name: 'gpu-box',
    connection: 'ssh',
    ssh: sshDetails(GPU, '10.0.0.42', 22, 'brian'),
    server: null,
    serverInstall: null,
    serverInstallAction: 'none'
  },
  {
    id: toMachineId(KESSEL),
    recordId: KESSEL,
    name: 'kessel-ml',
    connection: 'server',
    ssh: sshDetails('kessel-ssh', 'kessel-ml', 22, 'brian'),
    server: { environmentId: KESSEL, name: 'kessel-ml', endpoint: 'ws://kessel-ml:6768' },
    serverInstall: null,
    serverInstallAction: 'none'
  },
  {
    id: toMachineId(NAS),
    recordId: NAS,
    name: 'nas',
    connection: 'ssh',
    ssh: sshDetails(NAS, 'nas.local', 2222, 'admin'),
    server: null,
    serverInstall: null,
    serverInstallAction: 'none'
  }
]

function machineView(machineId: string): MachineView {
  return MACHINES.find((machine) => machine.id === machineId) ?? MACHINES[0]!
}
