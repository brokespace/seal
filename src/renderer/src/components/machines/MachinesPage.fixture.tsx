import { defineFixture } from '../../component-fixtures/component-fixture'
import { toSshExecutionHostId } from '../../../../shared/execution-host'
import type {
  MachineFileEntry,
  MachineMetrics,
  MachineTransfer
} from '../../../../shared/machines/machine-types'
import type { SshConnectionState, SshTarget } from '../../../../shared/ssh-types'
import type { MachinesApi } from '../../../../preload/api/machines/machines-bridge'
import MachinesPage from './MachinesPage'

const GPU = 'gpu-box'
const NAS = 'nas'
const HOME = '/home/brian'
const now = Date.now()

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

const METRICS: Record<string, MachineMetrics> = {
  local: metrics({
    hostname: 'brians-mbp',
    os: 'darwin',
    osRelease: 'macOS 15.1',
    arch: 'arm64',
    cpuCount: 12,
    loadAverage: [2.1, 1.8, 1.6],
    homeDir: '/Users/brian'
  }),
  [toSshExecutionHostId(GPU)]: metrics({
    hostname: 'gpu-box',
    osRelease: 'Ubuntu 24.04.1 LTS',
    cpuCount: 32,
    cpuModel: 'AMD Ryzen Threadripper 7970X',
    loadAverage: [26.4, 22.1, 18.9],
    memTotalBytes: 128 * 1024 ** 3,
    memAvailableBytes: 22 * 1024 ** 3,
    diskTotalBytes: 4 * 1024 ** 4,
    diskAvailableBytes: 1.1 * 1024 ** 4,
    uptimeSeconds: 1_209_600
  })
}

const TRANSFERS: MachineTransfer[] = [
  {
    id: 't1',
    machineId: toSshExecutionHostId(GPU),
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
    machineId: toSshExecutionHostId(GPU),
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

const fakeMachinesApi: MachinesApi = {
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
  onDirChanged: () => () => {}
}

const TARGETS: SshTarget[] = [
  { id: GPU, label: 'gpu-box', host: '10.0.0.42', port: 22, username: 'brian' },
  { id: NAS, label: 'nas', host: 'nas.local', port: 2222, username: 'admin' }
]

const STATES = new Map<string, SshConnectionState>([
  [
    GPU,
    {
      targetId: GPU,
      status: 'connected',
      error: null,
      reconnectAttempt: 0,
      remotePlatform: 'linux'
    }
  ],
  [
    NAS,
    {
      targetId: NAS,
      status: 'auth-failed',
      error: 'Permission denied (publickey)',
      reconnectAttempt: 0
    }
  ]
])

function installFakes(): void {
  window.api.machines = fakeMachinesApi
  window.api.ssh.listTargets = async () => TARGETS
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function openGpuBox(frame: HTMLElement): Promise<void> {
  await wait(50)
  frame.querySelector<HTMLElement>(`[data-machine-id="${toSshExecutionHostId(GPU)}"]`)?.click()
  await wait(150)
}

function Page(): React.JSX.Element {
  return (
    <div style={{ height: 720 }}>
      <MachinesPage />
    </div>
  )
}

export const sshMachine = defineFixture({
  width: 1200,
  store: { sshConnectionStates: STATES },
  setup: installFakes,
  render: () => <Page />,
  interact: openGpuBox
})

function previewFixture(fileName: string) {
  return defineFixture({
    width: 1200,
    store: { sshConnectionStates: STATES },
    setup: installFakes,
    render: () => <Page />,
    interact: async (frame) => {
      await openGpuBox(frame)
      frame.querySelector<HTMLElement>(`[title="${HOME}/${fileName}"]`)?.click()
      await wait(1500)
    }
  })
}

export const markdownPreview = previewFixture('README.md')

export const imagePreview = previewFixture('loss-curve.png')
