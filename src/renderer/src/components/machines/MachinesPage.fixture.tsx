import { defineFixture } from '../../component-fixtures/component-fixture'
import { toMachineId } from '../../../../shared/machines/machine-types'
import type { SshConnectionState } from '../../../../shared/ssh-types'
import type { RuntimeHostStatusSnapshot } from '../../../../shared/remote-runtime/host-status/runtime-host-status'
import { ConfirmationDialogProvider } from '../confirmation-dialog'
import MachinesPage from './MachinesPage'
import { fakeMachinesApi, GPU, HOME, KESSEL, METRICS, NAS, now } from './machine-api-fixture'
import { A100_80GB, RTX_4090, seedFakeGpuHistory } from './machine-gpu-fixture-data'
import {
  SERVER_INSTALL_FIXTURE_IDS,
  SERVER_INSTALL_FIXTURE_MACHINES,
  serverInstallFixtureRuntimeStatuses,
  serverInstallFixtureSshStates
} from './machine-server-install-fixture-data'
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

function Page({ height = 720 }: { height?: number }): React.JSX.Element {
  return (
    <ConfirmationDialogProvider>
      <div style={{ height }}>
        <MachinesPage />
      </div>
    </ConfirmationDialogProvider>
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
    <ConfirmationDialogProvider>
      <div style={{ padding: 24 }}>
        <MachinesSettingsPane sshAddSignal={0} serverAddSignal={0} advanced={null} />
      </div>
    </ConfirmationDialogProvider>
  )
})

function installServerInstallFakes(machines = SERVER_INSTALL_FIXTURE_MACHINES): void {
  const metrics = { ...METRICS[toMachineId(GPU)]!, gpus: undefined }
  window.api.machines = {
    ...fakeMachinesApi,
    list: async () => machines,
    listTransfers: async () => [],
    getMetrics: async () => metrics
  }
  window.api.runtimeEnvironments.getStatusSnapshots = async () =>
    serverInstallFixtureRuntimeStatuses()
}

type ServerInstallFixtureKey = keyof typeof SERVER_INSTALL_FIXTURE_IDS

/** The Seal server status area of one machine, as its page shows it; `press` opens a dialog from it. */
function serverInstallFixture(
  key: ServerInstallFixtureKey,
  options: {
    width?: number
    press?: 'install' | 'keep-running' | 'reuse' | 'remove' | 'retry' | 'move-anyway'
    /** The install has not connected the machine yet, so its files cannot be browsed. */
    connecting?: boolean
  } = {}
) {
  return defineFixture({
    width: options.width ?? 1200,
    store: {
      sshConnectionStates: serverInstallFixtureSshStates(options.connecting ? key : undefined)
    },
    setup: () => installServerInstallFakes(),
    render: () => <Page />,
    interact: async (frame) => {
      await openMachine(frame, toMachineId(SERVER_INSTALL_FIXTURE_IDS[key]))
      if (options.press) {
        frame.querySelector<HTMLElement>(`[data-machine-server-action="${options.press}"]`)?.click()
        await wait(300)
      }
    }
  })
}

export const serverSystemd = serverInstallFixture('systemd')
export const serverLingerOff = serverInstallFixture('lingerOff')
export const serverLingerOffUnknownUser = serverInstallFixture('lingerOffUnknownUser')
export const serverLingerUnknown = serverInstallFixture('lingerUnknown')
export const serverPm2 = serverInstallFixture('pm2')
export const serverPm2NoBoot = serverInstallFixture('pm2NoBoot')
export const serverLaunchd = serverInstallFixture('launchd')
export const serverLaunchdNeedsLogin = serverInstallFixture('launchdNeedsLogin')
export const serverDetached = serverInstallFixture('detached')
export const serverRetry = serverInstallFixture('retry')
export const serverMoveBlocked = serverInstallFixture('moveBlocked')
export const serverOffer = serverInstallFixture('offer')
export const serverReuse = serverInstallFixture('reuse')
export const serverInstalling = serverInstallFixture('installing')
export const serverWaitsForHost = serverInstallFixture('waitsForHost')
export const serverInstallingConnecting = serverInstallFixture('installing', { connecting: true })
export const serverWaitsForHostConnecting = serverInstallFixture('waitsForHost', {
  connecting: true
})
export const serverInstall = serverInstallFixture('install')
export const serverKeepRunning = serverInstallFixture('keepRunning')
export const serverOwnServer = serverInstallFixture('ownServer')
export const serverOwnService = serverInstallFixture('ownService')
export const serverServiceRemains = serverInstallFixture('serviceRemains')
export const serverWaitsForTerminals = serverInstallFixture('waitsForTerminals')
export const serverMoveBlockedNarrow = serverInstallFixture('moveBlocked', { width: 560 })
export const serverLingerOffNarrow = serverInstallFixture('lingerOff', { width: 560 })
export const serverLaunchdNeedsLoginNarrow = serverInstallFixture('launchdNeedsLogin', {
  width: 560
})
export const serverReuseNarrow = serverInstallFixture('reuse', { width: 560 })

export const serverInstallDialog = serverInstallFixture('install', { press: 'install' })
export const serverOfferInstallDialog = serverInstallFixture('offer', { press: 'install' })
export const serverRetryDialog = serverInstallFixture('retry', { press: 'retry' })
export const serverMoveAnywayDialog = serverInstallFixture('moveBlocked', { press: 'move-anyway' })
export const serverKeepRunningDialog = serverInstallFixture('keepRunning', {
  press: 'keep-running'
})
export const serverReuseDialog = serverInstallFixture('reuse', { press: 'reuse' })
export const serverRemoveDialog = serverInstallFixture('systemd', { press: 'remove' })

const LISTED_STATES: readonly ServerInstallFixtureKey[] = [
  'offer',
  'reuse',
  'installing',
  'waitsForHost',
  'retry',
  'waitsForTerminals',
  'install',
  'systemd'
]

/** The list's badges: only an install that runs, failed, waits or is offered gets one. */
export const serverInstallList = defineFixture({
  width: 1200,
  store: { sshConnectionStates: serverInstallFixtureSshStates() },
  setup: () =>
    installServerInstallFakes(
      LISTED_STATES.flatMap((key) =>
        SERVER_INSTALL_FIXTURE_MACHINES.filter(
          (machine) => machine.id === toMachineId(SERVER_INSTALL_FIXTURE_IDS[key])
        )
      )
    ),
  render: () => <Page height={860} />,
  interact: (frame) => openMachine(frame, toMachineId(SERVER_INSTALL_FIXTURE_IDS.installing))
})
