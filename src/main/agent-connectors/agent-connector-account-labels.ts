import { app } from 'electron'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import type { SealAccountsStatus } from '../../shared/seal-accounts/seal-accounts-status'
import { activeMachineConnection } from '../../shared/machines/machine-record'
import { LOCAL_MACHINE_ID, type MachineId } from '../../shared/machines/machine-types'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getMachineRegistry } from '../machines/registry/machine-registry-service'
import { getSealAccountManager } from '../seal-accounts/seal-account-manager'
import type { ConnectorHome } from './agent-connector-homes'

const STATUS_TIMEOUT_MS = 20_000

export type ConnectorAccountName = { label: string; email: string | null }

/** The Seal accounts the machine knows, from its own Seal; SSH-only machines have none. */
export async function readMachineSealAccounts(
  machineId: MachineId
): Promise<SealAccountCandidate[]> {
  if (machineId === LOCAL_MACHINE_ID) {
    const manager = getSealAccountManager()
    return manager ? [...manager.candidates('claude'), ...manager.candidates('codex')] : []
  }
  const record = getMachineRegistry().record(machineId)
  if (!record?.environmentId || activeMachineConnection(record) !== 'server') {
    return []
  }
  const response = await callRuntimeEnvironment(
    app.getPath('userData'),
    record.environmentId,
    'seal.accounts.status',
    { refreshUsage: false },
    STATUS_TIMEOUT_MS
  ).catch(() => null)
  if (!response?.ok) {
    return []
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the machine's Seal answers `seal.accounts.status` with this shape; missing providers fall back below.
  const status = response.result as Partial<SealAccountsStatus> | null
  return [
    ...(status?.providers?.claude?.candidates ?? []),
    ...(status?.providers?.codex?.candidates ?? [])
  ]
}

/** The account's name in Seal, else the email the folder is signed in with. */
export function connectorAccountName(
  home: ConnectorHome,
  candidates: readonly SealAccountCandidate[],
  folderEmail: string | null
): ConnectorAccountName {
  const candidate = candidates.find(
    (entry) =>
      entry.provider === home.agent &&
      (home.profileId ? entry.localId === home.profileId : entry.systemLogin && !entry.localId)
  )
  const email = candidate?.email ?? folderEmail
  const agentName = home.agent === 'claude' ? 'Claude' : 'Codex'
  return {
    label:
      candidate?.label ??
      email ??
      (home.profileId ? `${agentName} ${home.profileId.slice(0, 8)}` : agentName),
    email
  }
}
