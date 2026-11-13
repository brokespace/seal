import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { isRuntimeEnvironmentManuallyDisconnected } from '../../ipc/runtime-environments/runtime-environment-manual-disconnect'
import { getRuntimeEnvironmentStatusSnapshot } from '../../ipc/runtime-environments/runtime-environment-request-connections'
import { callRuntimeEnvironment } from '../../ipc/runtime-environments/runtime-environment-transport-routing'
import type { LiveSessionHost } from './live-session-hosts'
import { runtimeLiveSessionHost, type RuntimeEnvironmentCall } from './runtime-live-session-host'

/** Paired remote servers (Settings > Remote servers) whose last status check answered. */
export function connectedRuntimeHosts(userDataPath: string): LiveSessionHost[] {
  // Never wake a stopped WSL host or sleeping VM just to look for agents.
  const call: RuntimeEnvironmentCall = (environmentId, method, params, timeoutMs) =>
    callRuntimeEnvironment(
      userDataPath,
      environmentId,
      method,
      params,
      timeoutMs,
      undefined,
      undefined,
      {
        preparation: { wslStart: 'never' }
      }
    )
  return listEnvironments(userDataPath).flatMap((environment): LiveSessionHost[] => {
    const snapshot = getRuntimeEnvironmentStatusSnapshot(environment.id)
    if (
      isRuntimeEnvironmentManuallyDisconnected(environment.id) ||
      !snapshot ||
      snapshot.retired ||
      snapshot.verification !== 'verified' ||
      // Discovery reads ps, tmux and transcripts with a POSIX shell.
      snapshot.status?.hostPlatform === 'win32'
    ) {
      return []
    }
    return [runtimeLiveSessionHost({ id: environment.id, label: environment.name }, call)]
  })
}
