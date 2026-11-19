import { app } from 'electron'
import { AGENT_CONNECTORS_IPC } from '../../shared/agent-connectors/agent-connector-types'
import { LOCAL_MACHINE_ID } from '../../shared/machines/machine-types'
import {
  machineIdOf,
  requireString,
  type MachineInvokeRegistrar
} from '../machines/machine-ipc-args'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { getMachineRegistry } from '../machines/registry/machine-registry-service'
import { getSealAccountManager } from '../seal-accounts/seal-account-manager'
import { upkeepClaudeMcpSignIns } from '../seal-accounts/seal-mcp-sign-in-upkeep'
import type { ConnectorHome } from './agent-connector-homes'
import { connectorHomeFor, listAgentConnectors } from './agent-connector-listing'
import {
  cancelConnectorSignIn,
  startConnectorSignIn,
  submitConnectorRedirect,
  waitForConnectorSignIn
} from './agent-connector-sign-in'

/** Default-home sign-ins: this machine shares them at once, another on its next upkeep. */
const sharing = new Map<string, 'now' | 'soon'>()

/**
 * Seal shares a Claude server sign-in from the default home with every account except on macOS,
 * so sign in there once. claude.ai connectors belong to one account and stay in its home.
 */
async function signInHome(
  connection: MachineConnection,
  home: ConnectorHome,
  name: string
): Promise<ConnectorHome> {
  if (home.agent !== 'claude' || home.configDir === null || name.startsWith('claude.ai ')) {
    return home
  }
  if ((await connection.dialect()) === 'posix') {
    const uname = await connection.exec('uname -s', { timeoutMs: 10_000 })
    if (uname.stdout.trim() !== 'Linux') {
      return home
    }
  }
  return { ...home, configDir: null, profileId: null }
}

export function registerAgentConnectorsHandlers(handle: MachineInvokeRegistrar): void {
  handle(AGENT_CONNECTORS_IPC.list, async (args) => {
    const machineId = machineIdOf(args.machineId)
    const connection = getMachineRegistry().connection(machineId)
    await connection.connect()
    return listAgentConnectors(connection, {
      dataRoot:
        machineId === LOCAL_MACHINE_ID
          ? (getSealAccountManager()?.dataRoot ?? app.getPath('userData'))
          : null,
      force: args.force === true,
      accountId: typeof args.accountId === 'string' && args.accountId ? args.accountId : null
    })
  })
  handle(AGENT_CONNECTORS_IPC.signInStart, async (args) => {
    const machineId = machineIdOf(args.machineId)
    const home = connectorHomeFor(machineId, requireString(args.accountId, 'accountId'))
    if (!home) {
      throw new Error('Refresh the list; that account is not on this machine any more')
    }
    const name = requireString(args.name, 'name')
    if (name.startsWith('-') || /[\r\n]/.test(name)) {
      throw new Error('That is not a connector name')
    }
    const connection = getMachineRegistry().connection(machineId)
    await connection.connect()
    const target = await signInHome(connection, home, name)
    const started = await startConnectorSignIn(connection, target, name)
    if (started.kind === 'url' && target !== home) {
      sharing.set(started.sessionId, machineId === LOCAL_MACHINE_ID ? 'now' : 'soon')
    }
    return started
  })
  handle(AGENT_CONNECTORS_IPC.signInSubmit, (args) =>
    submitConnectorRedirect(
      requireString(args.sessionId, 'sessionId'),
      requireString(args.redirectUrl, 'redirectUrl')
    )
  )
  handle(AGENT_CONNECTORS_IPC.signInWait, async (args) => {
    const sessionId = requireString(args.sessionId, 'sessionId')
    const result = await waitForConnectorSignIn(sessionId)
    const share = sharing.get(sessionId)
    sharing.delete(sessionId)
    const manager = getSealAccountManager()
    if (!result.ok || !share) {
      return result
    }
    if (share === 'now' && manager) {
      await upkeepClaudeMcpSignIns(manager)
      return result
    }
    return {
      ...result,
      message: [
        result.message,
        'Seal shares it with every account on that machine within five minutes.'
      ]
        .filter(Boolean)
        .join(' ')
    }
  })
  handle(AGENT_CONNECTORS_IPC.signInCancel, (args) =>
    cancelConnectorSignIn(requireString(args.sessionId, 'sessionId'))
  )
}
