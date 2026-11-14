import { getAppEnvironment } from '../../../shared/app-environment'
import { getRuntimeEnvironmentStatusSnapshots } from '../../ipc/runtime-environments/runtime-environment-request-connections'
import {
  createRuntimeMachineChannel,
  type RuntimeMachineChannel
} from '../../machines/runtime/runtime-machine-channel'
import { RuntimeMachineFileSystem } from '../../machines/runtime/runtime-machine-filesystem'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import type { HomeChatRuntimeSource } from './home-chat-runtime-machine'

/** The Seal servers this desktop is paired with, read from the same store the Machines page uses. */
export function createPairedRuntimeSource(): HomeChatRuntimeSource {
  const channels = new Map<string, RuntimeMachineChannel>()
  const channel = (environmentId: string): RuntimeMachineChannel => {
    let existing = channels.get(environmentId)
    if (!existing) {
      existing = createRuntimeMachineChannel(getAppEnvironment().getPath('userData'), environmentId)
      channels.set(environmentId, existing)
    }
    return existing
  }
  return {
    environments: () =>
      listEnvironments(getAppEnvironment().getPath('userData')).map((environment) => ({
        id: environment.id,
        name: environment.name,
        ...(environment.sshAccess ? { sshAccess: environment.sshAccess } : {})
      })),
    statuses: () => getRuntimeEnvironmentStatusSnapshots(),
    call: (environmentId, method, params, timeoutMs) =>
      channel(environmentId).call(method, params, timeoutMs),
    fileSystem: (environmentId) =>
      new RuntimeMachineFileSystem(environmentId, channel(environmentId))
  }
}
