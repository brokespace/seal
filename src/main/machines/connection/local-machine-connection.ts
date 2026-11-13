import { LOCAL_MACHINE_ID } from '../../../shared/machines/machine-types'
import { createLocalMachineFileSystem } from '../filesystem/local-machine-filesystem'
import { collectLocalMachineMetrics } from '../metrics/local-machine-metrics'
import { execOnThisMachine } from './local-machine-exec'
import type { MachineConnection } from './machine-connection'
import { machineIdentityScript, parseMachineIdentity } from './machine-identity-probe'
import { withPollingWatch } from './machine-polling-watch'
import { openShellOnThisMachine } from './local-machine-shell'

const dialect = process.platform === 'win32' ? 'powershell' : 'posix'

export function createLocalMachineConnection(): MachineConnection {
  return {
    machineId: LOCAL_MACHINE_ID,
    transport: 'local',
    isConnected: () => true,
    connect: async () => {},
    dialect: async () => dialect,
    exec: execOnThisMachine,
    files: withPollingWatch(createLocalMachineFileSystem()),
    metrics: collectLocalMachineMetrics,
    identity: async () =>
      parseMachineIdentity(
        (await execOnThisMachine(machineIdentityScript(dialect), { timeoutMs: 15_000 })).stdout
      ),
    openShell: openShellOnThisMachine
  }
}
