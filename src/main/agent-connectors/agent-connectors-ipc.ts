import { app } from 'electron'
import { AGENT_CONNECTORS_IPC } from '../../shared/agent-connectors/agent-connector-types'
import { LOCAL_MACHINE_ID } from '../../shared/machines/machine-types'
import {
  machineIdOf,
  requireString,
  type MachineInvokeRegistrar
} from '../machines/machine-ipc-args'
import { getMachineRegistry } from '../machines/registry/machine-registry-service'
import { getSealAccountManager } from '../seal-accounts/seal-account-manager'
import { connectorHomeFor, listAgentConnectors } from './agent-connector-listing'
import {
  cancelConnectorSignIn,
  startConnectorSignIn,
  submitConnectorRedirect,
  waitForConnectorSignIn
} from './agent-connector-sign-in'

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
    return startConnectorSignIn(connection, home, name)
  })
  handle(AGENT_CONNECTORS_IPC.signInSubmit, (args) =>
    submitConnectorRedirect(
      requireString(args.sessionId, 'sessionId'),
      requireString(args.redirectUrl, 'redirectUrl')
    )
  )
  handle(AGENT_CONNECTORS_IPC.signInWait, (args) =>
    waitForConnectorSignIn(requireString(args.sessionId, 'sessionId'))
  )
  handle(AGENT_CONNECTORS_IPC.signInCancel, (args) =>
    cancelConnectorSignIn(requireString(args.sessionId, 'sessionId'))
  )
}
