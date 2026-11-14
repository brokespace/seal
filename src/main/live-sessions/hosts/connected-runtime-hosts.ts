import { isRuntimeEnvironmentManuallyDisconnected } from '../../ipc/runtime-environments/connectivity/runtime-environment-manual-disconnect'
import { getRuntimeEnvironmentStatusSnapshot } from '../../ipc/runtime-environments/connections/runtime-environment-request-connections'
import { callRuntimeEnvironment } from '../../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import type { LiveSessionHost } from './live-session-hosts'
import { runtimeLiveSessionHost, type RuntimeEnvironmentCall } from './runtime-live-session-host'

/** Calls a paired server's runtime without waking a stopped WSL host or sleeping VM for it. */
export function runtimeEnvironmentCall(userDataPath: string): RuntimeEnvironmentCall {
  return (environmentId, method, params, timeoutMs) =>
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
}

/** The runtime-side scan for a paired server whose last status check answered, or null to skip it. */
export function runtimeScanRunner(
  userDataPath: string
): (environmentId: string, label: string) => LiveSessionHost['run'] | null {
  const call = runtimeEnvironmentCall(userDataPath)
  return (environmentId, label) => {
    const snapshot = getRuntimeEnvironmentStatusSnapshot(environmentId)
    if (
      isRuntimeEnvironmentManuallyDisconnected(environmentId) ||
      !snapshot ||
      snapshot.retired ||
      snapshot.verification !== 'verified' ||
      // Discovery reads ps, tmux and transcripts with a POSIX shell.
      snapshot.status?.hostPlatform === 'win32'
    ) {
      return null
    }
    return runtimeLiveSessionHost({ id: environmentId, label }, call).run
  }
}
