import { ipcMain } from 'electron'
import type { OrcadManagedRuntimeStatus } from '../../../../shared/orcad-managed-runtime'
import { createManagedOrcadEnvironment } from '../../../managed-server/lifecycle/orcad-runtime-deployment'
import { getManagedOrcadRuntimeStatus } from '../../../managed-server/lifecycle/orcad-runtime-status'
import { assertServerDeployIsConfirmed } from '../../../machines/server-install/server-install-consent'

export function registerOrcadRuntimeLifecycleHandlers(options: {
  getUserDataPath: () => string
}): void {
  ipcMain.handle(
    'runtimeEnvironments:deployOrcad',
    async (_event, args: { name: string; sshTargetId: string; force?: boolean }) => {
      const sshTargetId = requiredString(args?.sshTargetId, 'SSH target')
      await assertSettingsDeployIsConfirmed(sshTargetId)
      return createManagedOrcadEnvironment(options.getUserDataPath(), {
        name: requiredString(args?.name, 'Server name'),
        sshTargetId,
        force: args?.force === true
      })
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:getOrcadStatus',
    (_event, args: { selector: string }): Promise<OrcadManagedRuntimeStatus> =>
      getManagedOrcadRuntimeStatus(
        options.getUserDataPath(),
        requiredString(args?.selector, 'Server')
      )
  )
}

/** Settings changes a server Seal already deployed; a first install starts on the machine's page, where the user confirms it. */
export async function assertSettingsDeployIsConfirmed(sshTargetId: string): Promise<void> {
  // Import lazily: the machine registry wires the runtime-environment handlers this one is part of.
  const { getMachineRegistry } = await import('../../../machines/registry/machine-registry-service')
  assertServerDeployIsConfirmed(getMachineRegistry(), sshTargetId)
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`)
  }
  return value.trim()
}
