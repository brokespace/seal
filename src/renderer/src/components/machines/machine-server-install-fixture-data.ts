import { toMachineId } from '../../../../shared/machines/machine-types'
import type { MachineServerInstall } from '../../../../shared/machines/machine-record'
import type { MachineView } from '../../../../shared/machines/machine-view'
import type { SshConnectionState } from '../../../../shared/ssh-types'
import type { RuntimeHostStatusSnapshot } from '../../../../shared/remote-runtime/host-status/runtime-host-status'

const now = Date.now()

/** One machine per state of the Seal server status area, keyed by what the fixture shows. */
export const SERVER_INSTALL_FIXTURE_IDS = {
  systemd: 'build-01',
  lingerOff: 'build-02',
  lingerOffUnknownUser: 'build-03',
  lingerUnknown: 'build-04',
  pm2: 'container-02',
  pm2NoBoot: 'container-01',
  launchd: 'mac-mini',
  launchdNeedsLogin: 'mac-headless',
  detached: 'legacy-box',
  retry: 'small-disk',
  moveBlocked: 'busy-box',
  offer: 'super9',
  reuse: 'own-serve',
  installing: 'fresh-box',
  waitsForHost: 'shared-box',
  install: 'plain-ssh',
  keepRunning: 'idle-server',
  ownService: 'own-service',
  serviceRemains: 'half-removed',
  waitsForTerminals: 'open-terminals'
} as const

type FixtureKey = keyof typeof SERVER_INSTALL_FIXTURE_IDS

const INSTALLED: MachineServerInstall = {
  policy: 'auto',
  state: 'installed',
  version: '1.4.2',
  attemptedAt: now - 86_400_000
}

const MOVE_BLOCKED_DETAIL = `2 unsaved editor drafts
  ~/seal/src/main/index.ts
  ~/seal/docs/notes.md
1 terminal still running through the SSH connection
  ~/seal: pnpm dev`

const STATES: Record<FixtureKey, Partial<MachineView> & Pick<MachineView, 'connection'>> = {
  systemd: {
    connection: 'server',
    serverInstall: { ...INSTALLED, manager: 'systemd-user', linger: true }
  },
  // The machine's own account differs from the SSH details' `deploy`: the command names the former.
  lingerOff: {
    connection: 'server',
    serverInstall: { ...INSTALLED, manager: 'systemd-user', linger: false },
    serverLingerOff: true,
    serverHostUser: 'brian'
  },
  lingerOffUnknownUser: {
    connection: 'server',
    serverInstall: { ...INSTALLED, manager: 'systemd-user', linger: false },
    serverLingerOff: true
  },
  lingerUnknown: {
    connection: 'server',
    serverInstall: { ...INSTALLED, manager: 'systemd-user' },
    serverHostUser: 'brian'
  },
  pm2: {
    connection: 'server',
    serverInstall: { ...INSTALLED, manager: 'pm2' },
    serverStartsAtBoot: true
  },
  pm2NoBoot: {
    connection: 'server',
    serverInstall: { ...INSTALLED, manager: 'pm2' },
    serverStartsAtBoot: false
  },
  launchd: { connection: 'server', serverInstall: { ...INSTALLED, manager: 'launchd' } },
  launchdNeedsLogin: {
    connection: 'server',
    serverInstall: { ...INSTALLED, manager: 'detached' },
    serverInstallAction: 'keep-running',
    serverLaunchdNeedsLogin: true
  },
  detached: { connection: 'server', serverInstall: { ...INSTALLED, manager: 'detached' } },
  retry: {
    connection: 'ssh',
    serverInstall: {
      policy: 'auto',
      state: 'failed',
      reason: 'no space left on device',
      attemptedAt: now - 60_000
    },
    serverInstallAction: 'retry'
  },
  moveBlocked: {
    connection: 'ssh',
    serverInstall: { policy: 'auto', state: 'failed', attemptedAt: now - 60_000 },
    serverInstallAction: 'retry',
    serverMoveBlocked: { detail: MOVE_BLOCKED_DETAIL }
  },
  offer: { connection: 'ssh', serverInstallAction: 'offer' },
  reuse: {
    connection: 'ssh',
    serverInstallAction: 'reuse',
    serverOwnServe: { manager: 'systemd-user', name: 'seal-serve.service' }
  },
  installing: {
    connection: 'ssh',
    serverInstall: { policy: 'auto', state: 'pending', attemptedAt: now },
    serverInstallAction: 'installing'
  },
  waitsForHost: {
    connection: 'ssh',
    serverInstall: { policy: 'auto', state: 'pending', attemptedAt: now },
    serverInstallAction: 'installing',
    serverInstallWaitsForHost: true
  },
  install: {
    connection: 'ssh',
    serverInstall: { policy: 'never', state: 'declined' },
    serverInstallAction: 'install'
  },
  keepRunning: { connection: 'server', serverInstallAction: 'keep-running' },
  ownService: { connection: 'server', serverKeeper: 'systemd-user' },
  serviceRemains: {
    connection: 'ssh',
    serverInstall: { policy: 'never', state: 'installed', manager: 'systemd-user' },
    serverInstallAction: 'install',
    serverServiceRemains: true
  },
  waitsForTerminals: {
    connection: 'ssh',
    serverInstall: {
      policy: 'auto',
      state: 'pending',
      reason:
        '2 terminals are still running on this machine, and the install will finish when these terminals are closed',
      attemptedAt: now - 60_000
    },
    serverInstallAction: 'retry'
  }
}

function fixtureMachine(key: FixtureKey): MachineView {
  const name = SERVER_INSTALL_FIXTURE_IDS[key]
  const state = STATES[key]
  return {
    id: toMachineId(name),
    recordId: name,
    name,
    ssh: {
      targetId: name,
      address: `deploy@${name}.internal`,
      host: `${name}.internal`,
      username: 'deploy',
      port: 22,
      identityFile: null,
      jumpHost: null
    },
    server:
      state.connection === 'server'
        ? { environmentId: `${name}-env`, name, endpoint: 'ws://127.0.0.1:6768' }
        : null,
    serverInstall: null,
    serverInstallAction: 'none',
    ...state
  }
}

export const SERVER_INSTALL_FIXTURE_MACHINES: MachineView[] = Object.keys(STATES)
  .filter((key): key is FixtureKey => key in SERVER_INSTALL_FIXTURE_IDS)
  .map(fixtureMachine)

/**
 * Every fixture machine is reachable, so each one's page shows its status area in place.
 * `connecting` names the machine whose install is still bringing its connection up.
 */
export function serverInstallFixtureSshStates(
  connecting?: FixtureKey
): Map<string, SshConnectionState> {
  const connectingId = connecting ? SERVER_INSTALL_FIXTURE_IDS[connecting] : null
  return new Map(
    SERVER_INSTALL_FIXTURE_MACHINES.filter((machine) => machine.connection === 'ssh').map(
      (machine) => [
        machine.recordId,
        {
          targetId: machine.recordId,
          status: machine.recordId === connectingId ? 'connecting' : 'connected',
          error: null,
          reconnectAttempt: 0,
          remotePlatform: 'linux'
        }
      ]
    )
  )
}

export function serverInstallFixtureRuntimeStatuses(): RuntimeHostStatusSnapshot[] {
  return SERVER_INSTALL_FIXTURE_MACHINES.flatMap((machine) =>
    machine.connection === 'server' && machine.server
      ? [
          {
            environmentId: machine.server.environmentId,
            pairingRevision: 1,
            sequence: 1,
            checkedAt: now,
            verification: 'verified' as const,
            transport: 'ready' as const,
            status: {
              runtimeId: `${machine.recordId}-runtime`,
              rendererGraphEpoch: 1,
              graphStatus: 'ready' as const,
              authoritativeWindowId: null,
              liveTabCount: 0,
              liveLeafCount: 0,
              hostPlatform: 'linux' as const,
              machineName: machine.name
            }
          }
        ]
      : []
  )
}
