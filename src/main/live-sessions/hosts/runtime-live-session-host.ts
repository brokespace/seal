import { toRuntimeExecutionHostId } from '../../../shared/execution-host'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { DEFAULT_SCRIPT_TIMEOUT_MS } from './local-shell-script'
import type { LiveSessionHost } from './live-session-hosts'

export const LIVE_SESSION_HOST_RUN_METHOD = 'liveSessions.hostRun'
export function runtimeLiveSessionsOutdated(label: string): string {
  return `${label} runs an older Seal: update Seal on this server to see and message its agent sessions`
}
/** The RPC round trip on top of the script's own budget. */
const CALL_MARGIN_MS = 10_000

export type RuntimeEnvironmentCall = (
  environmentId: string,
  method: string,
  params: unknown,
  timeoutMs: number
) => Promise<RuntimeRpcResponse<unknown>>

/** A paired remote server: each script runs there through its runtime RPC, like `sh -s` over SSH. */
export function runtimeLiveSessionHost(
  environment: { id: string; label: string },
  call: RuntimeEnvironmentCall
): LiveSessionHost {
  return {
    machine: {
      hostId: toRuntimeExecutionHostId(environment.id),
      label: environment.label,
      kind: 'remote',
      executionHostId: toRuntimeExecutionHostId(environment.id),
      connection: 'server'
    },
    async run(script, options) {
      const timeoutMs = options?.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS
      const response = await call(
        environment.id,
        LIVE_SESSION_HOST_RUN_METHOD,
        { script, timeoutMs },
        timeoutMs + CALL_MARGIN_MS
      )
      if (response.ok !== true) {
        // Servers from before live sessions answer every new method this way.
        throw new Error(
          response.error.code === 'method_not_found'
            ? runtimeLiveSessionsOutdated(environment.label)
            : response.error.message
        )
      }
      const result = response.result
      if (
        typeof result !== 'object' ||
        result === null ||
        !('stdout' in result) ||
        typeof result.stdout !== 'string'
      ) {
        throw new Error(runtimeLiveSessionsOutdated(environment.label))
      }
      return result.stdout
    }
  }
}
