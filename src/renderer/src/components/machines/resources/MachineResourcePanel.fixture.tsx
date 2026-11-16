import { defineFixture } from '../../../component-fixtures/component-fixture'
import { toRuntimeExecutionHostId } from '../../../../../shared/execution-host'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import type { MachineGpu } from '../../../../../shared/machines/machine-gpu-types'
import { toMachineId, type MachineMetrics } from '../../../../../shared/machines/machine-types'
import { fakeMachinesApi, KESSEL, METRICS } from '../machine-api-fixture'
import type { MachineCpuTemperatureSetup } from '../../../../../shared/machines/machine-cpu-temperature-types'
import {
  RYZEN_LIBRE_HARDWARE_MONITOR,
  WINDOWS_SETUP_NOT_SET_UP
} from '../machine-cpu-temperature-fixture-data'
import { A100_80GB, asMig, fakeGpus, fakeGpuSnapshot, RTX_4090 } from '../machine-gpu-fixture-data'
import { fakeDiskIndexNotStartedReply } from '../machine-disk-index-fixture-data'
import { MachineResourcePanel } from './MachineResourcePanel'
import type { MachineResourceKind } from './machine-resource-requests'

const MACHINE: MachineSummary = {
  id: toMachineId(KESSEL),
  connection: 'server',
  label: 'kessel-ml',
  address: 'kessel-ml',
  status: 'online',
  statusDetail: null,
  os: 'linux',
  sshTargetId: 'kessel-ssh',
  runtimeEnvironmentId: KESSEL,
  executionHostId: toRuntimeExecutionHostId(KESSEL)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function press(frame: HTMLElement, text: string): void {
  const buttons = Array.from(frame.querySelectorAll<HTMLElement>('button, [role="tab"]'))
  const target = buttons.find((button) => button.textContent?.trim() === text)
  // Radix tabs select on mousedown, not click.
  target?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
  target?.click()
}

function panel(
  kind: MachineResourceKind,
  then?: (frame: HTMLElement) => void,
  api: typeof fakeMachinesApi = fakeMachinesApi,
  metrics: MachineMetrics | null = METRICS[toMachineId(KESSEL)] ?? null,
  width = 920
) {
  return defineFixture({
    width,
    setup: () => {
      window.api.machines = api
    },
    render: () => (
      <div className="flex flex-col bg-background" style={{ minHeight: 400 }}>
        <MachineResourcePanel
          machine={MACHINE}
          metrics={metrics}
          kind={kind}
          onClose={() => {}}
          onReveal={() => {}}
        />
      </div>
    ),
    interact: async (frame) => {
      await wait(400)
      then?.(frame)
      await wait(400)
    }
  })
}

export const cpu = panel('cpu')

export const cpuNarrow = panel('cpu', undefined, undefined, undefined, 420)

const { cpuTemperature: _reading, ...NO_SENSOR } = METRICS[toMachineId(KESSEL)]!

export const cpuNoSensor = panel('cpu', undefined, undefined, NO_SENSOR)

const WINDOWS: MachineMetrics = { ...NO_SENSOR, os: 'win32', loadAverage: null }

export const cpuWindows = panel('cpu', undefined, undefined, {
  ...WINDOWS,
  cpuTemperature: RYZEN_LIBRE_HARDWARE_MONITOR
})

export const cpuWindowsNoSensor = panel('cpu', undefined, undefined, WINDOWS)

function windowsSetup(
  setup: Partial<MachineCpuTemperatureSetup>,
  metrics: MachineMetrics = WINDOWS,
  then?: (frame: HTMLElement) => void
) {
  return panel(
    'cpu',
    then,
    {
      ...fakeMachinesApi,
      cpuTemperatureSetup: async () => ({ ...WINDOWS_SETUP_NOT_SET_UP, ...setup })
    },
    metrics
  )
}

export const cpuWindowsSetupConfirm = windowsSetup({}, WINDOWS, (frame) =>
  press(frame, 'Set up CPU temperature')
)

export const cpuWindowsSetupRunning = windowsSetup(
  { state: 'running' },
  { ...WINDOWS, cpuTemperature: RYZEN_LIBRE_HARDWARE_MONITOR }
)

export const cpuWindowsSetupRestart = windowsSetup({
  state: 'running',
  message: 'Restart Windows to finish installing the PawnIO driver.'
})

export const cpuWindowsSetupStopped = windowsSetup({ state: 'stopped' })

export const cpuWindowsSetupFailed = windowsSetup({
  state: 'failed',
  message:
    'Setup stopped while installing LibreHardwareMonitor: The remote name could not be resolved: github.com'
})

export const cpuWindowsSetupNeedsAdmin = windowsSetup({ elevation: 'needs-admin' })

export const cpuWindowsSetupNoDesktop = windowsSetup({ elevation: 'no-desktop' })

export const cpuWindowsSetupRemoveConfirm = windowsSetup(
  { state: 'running', elevation: 'elevated' },
  { ...WINDOWS, cpuTemperature: RYZEN_LIBRE_HARDWARE_MONITOR },
  (frame) => press(frame, 'Remove')
)

export const memory = panel('memory')

export const dockerRemoveConfirm = panel('memory', (frame) => press(frame, 'Remove'))

export const dockerPruneReview = panel('memory', (frame) =>
  frame
    .querySelector<HTMLElement>('[data-machine-cleanup-target="docker-dangling-images"] button')
    ?.click()
)

function gpuPanel(gpus: MachineGpu[], then?: (frame: HTMLElement) => void, width?: number) {
  const metrics = { ...METRICS[toMachineId(KESSEL)]!, gpus }
  const snapshot = fakeGpuSnapshot(gpus)
  return panel(
    'gpu',
    then,
    {
      ...fakeMachinesApi,
      listProcesses: async (args) => ({
        ...(await fakeMachinesApi.listProcesses(args)),
        gpu: snapshot
      })
    },
    metrics,
    width
  )
}

export const gpu = gpuPanel(fakeGpus(A100_80GB, 8))

export const gpuNarrow = gpuPanel(fakeGpus(A100_80GB, 8), undefined, 420)

export const gpuBesideSidebars = gpuPanel(fakeGpus(A100_80GB, 8), undefined, 520)

export const gpuSingle = gpuPanel(fakeGpus(RTX_4090, 1))

export const gpuMig = gpuPanel(fakeGpus(A100_80GB, 2).map(asMig))

export const gpuForceKillConfirm = gpuPanel(fakeGpus(A100_80GB, 8), (frame) =>
  press(frame, 'Force kill')
)

export const disk = panel('disk')

export const diskLargestFiles = panel('disk', (frame) => press(frame, 'Largest files'))

export const diskLargestFolders = panel('disk', (frame) => press(frame, 'Largest folders'))

export const diskCleanup = panel('disk', (frame) => press(frame, 'Clean up'))

export const diskIndexNotStarted = panel('disk', undefined, {
  ...fakeMachinesApi,
  diskIndex: async ({ request }) => fakeDiskIndexNotStartedReply('/home/brian', request)
})
