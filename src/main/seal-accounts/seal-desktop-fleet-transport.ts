import { app } from 'electron'
import { activeMachineConnection } from '../../shared/machines/machine-record'
import { LOCAL_MACHINE_ID, parseMachineId } from '../../shared/machines/machine-types'
import { SealAccountsImportCredentialParams } from '../../shared/rpc-contract/seal-accounts-params'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getMachineRegistry } from '../machines/registry/machine-registry-service'
import type { SealFleetTransport } from './seal-fleet-sync'
import { installLoginOnMachine } from './seal-machine-login-install'

const FLEET_CALL_TIMEOUT_MS = 60_000

/** Targets are machine ids (or bare server ids from older callers), routed by the machine's connection. */
export const sealDesktopFleetTransport: SealFleetTransport = async (target, method, params) => {
  const machineId = parseMachineId(target)
  const registry = getMachineRegistry()
  const record = machineId && machineId !== LOCAL_MACHINE_ID ? registry.record(machineId) : null
  if (machineId && !record) {
    throw new Error('That machine is no longer saved')
  }
  if (record && machineId && activeMachineConnection(record) === 'ssh') {
    if (method === 'seal.accounts.importCredential') {
      await installLoginOnMachine(
        registry.connection(machineId),
        SealAccountsImportCredentialParams.parse(params)
      )
      return {}
    }
    if (method === 'seal.accounts.applyFleetConfig') {
      return { policyApplied: false }
    }
    throw new Error('Connect this machine via its Seal server to manage its accounts')
  }
  const environmentId = record?.environmentId ?? target
  const response = await callRuntimeEnvironment(
    app.getPath('userData'),
    environmentId,
    method,
    method === 'seal.accounts.applyFleetConfig' && params && typeof params === 'object'
      ? { ...params, machineKey: `runtime:${environmentId}` }
      : params,
    FLEET_CALL_TIMEOUT_MS
  )
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return response.result
}
