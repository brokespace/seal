import { ipcRenderer } from 'electron'
import {
  AGENT_CONNECTORS_IPC,
  type AgentConnectorSignInResult,
  type AgentConnectorSignInStart,
  type AgentConnectorsSnapshot
} from '../../../shared/agent-connectors/agent-connector-types'
import type { MachineId } from '../../../shared/machines/machine-types'

export type AgentConnectorsApi = {
  /** Cached for minutes; `force` re-checks every account, `accountId` just that one. */
  list: (args: {
    machineId: MachineId
    force?: boolean
    accountId?: string
  }) => Promise<AgentConnectorsSnapshot>
  signInStart: (args: {
    machineId: MachineId
    accountId: string
    name: string
  }) => Promise<AgentConnectorSignInStart>
  /** Resolves to the CLI's refusal of the address, or null once it took it. */
  signInSubmit: (args: { sessionId: string; redirectUrl: string }) => Promise<string | null>
  /** Resolves when the CLI exits. */
  signInWait: (args: { sessionId: string }) => Promise<AgentConnectorSignInResult>
  signInCancel: (args: { sessionId: string }) => Promise<void>
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the channel map and the API type list the same names, and each channel takes that method's arguments.
export const agentConnectorsApi = Object.fromEntries(
  Object.entries(AGENT_CONNECTORS_IPC).map(([name, channel]) => [
    name,
    (args: unknown) => ipcRenderer.invoke(channel, args)
  ])
) as AgentConnectorsApi
