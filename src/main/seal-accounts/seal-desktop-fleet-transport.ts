import { app } from 'electron'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/runtime-environment-transport-routing'
import type { SealFleetTransport } from './seal-fleet-sync'

const FLEET_CALL_TIMEOUT_MS = 60_000

export const sealDesktopFleetTransport: SealFleetTransport = async (
  environmentId,
  method,
  params
) => {
  const response = await callRuntimeEnvironment(
    app.getPath('userData'),
    environmentId,
    method,
    params,
    FLEET_CALL_TIMEOUT_MS
  )
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return response.result
}
