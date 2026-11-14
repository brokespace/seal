import { defineFixture } from '../../component-fixtures/component-fixture'
import { toMachineId } from '../../../../shared/machines/machine-types'
import type { SshConnectionState } from '../../../../shared/ssh-types'
import type { RuntimeHostStatusSnapshot } from '../../../../shared/remote-runtime/host-status/runtime-host-status'
import MachinesPage from './MachinesPage'
import { fakeMachinesApi, GPU, HOME, KESSEL, NAS, now } from './machine-api-fixture'
import { A100_80GB, RTX_4090, seedFakeGpuHistory } from './machine-gpu-fixture-data'
import { MachinesSettingsPane } from '../settings/machines/MachinesSettingsPane'

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

const KESSEL_STATUS: RuntimeHostStatusSnapshot = {
  environmentId: KESSEL,
  pairingRevision: 1,
  sequence: 1,
  checkedAt: now,
  verification: 'verified',
  transport: 'ready',
  status: {
    runtimeId: 'kessel-runtime',
    rendererGraphEpoch: 1,
    graphStatus: 'ready',
    authoritativeWindowId: null,
    liveTabCount: 0,
    liveLeafCount: 0,
    hostPlatform: 'linux',
    machineName: 'kessel-ml'
  }
}

function installFakes(): void {
  window.api.machines = fakeMachinesApi
  window.api.runtimeEnvironments.getStatusSnapshots = async () => [KESSEL_STATUS]
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function openMachine(frame: HTMLElement, machineId: string): Promise<void> {
  await wait(50)
  frame.querySelector<HTMLElement>(`[data-machine-id="${machineId}"]`)?.click()
  await wait(150)
}

const openGpuBox = (frame: HTMLElement) => openMachine(frame, toMachineId(GPU))

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

export const runtimeMachine = defineFixture({
  width: 1200,
  store: { sshConnectionStates: STATES },
  setup: installFakes,
  render: () => <Page />,
  interact: (frame) => openMachine(frame, toMachineId(KESSEL))
})

function gpuDetailFixture(machine: string, model: typeof A100_80GB, count: number, width: number) {
  return defineFixture({
    width,
    store: { sshConnectionStates: STATES },
    setup: () => {
      installFakes()
      seedFakeGpuHistory(toMachineId(machine), model, count)
    },
    render: () => <Page />,
    interact: async (frame) => {
      await openMachine(frame, toMachineId(machine))
      frame.querySelector<HTMLElement>('[data-machine-meter="gpu"]')?.click()
      await wait(600)
    }
  })
}

export const gpuDetail = gpuDetailFixture(KESSEL, A100_80GB, 8, 1200)

export const gpuDetailTwo = gpuDetailFixture(GPU, RTX_4090, 2, 1200)

export const gpuDetailNarrow = gpuDetailFixture(KESSEL, A100_80GB, 8, 560)

export const diskDetail = defineFixture({
  width: 1200,
  store: { sshConnectionStates: STATES },
  setup: installFakes,
  render: () => <Page />,
  interact: async (frame) => {
    await openMachine(frame, toMachineId(KESSEL))
    frame.querySelector<HTMLElement>('[data-machine-meter="disk"]')?.click()
    await wait(600)
  }
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

export const settingsMachines = defineFixture({
  width: 860,
  store: { sshConnectionStates: STATES },
  setup: installFakes,
  render: () => (
    <div style={{ padding: 24 }}>
      <MachinesSettingsPane sshAddSignal={0} serverAddSignal={0} advanced={null} />
    </div>
  )
})
