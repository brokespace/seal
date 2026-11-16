import {
  isRuntimeEnvironmentManuallyDisconnected,
  RUNTIME_MANUALLY_DISCONNECTED_MESSAGE
} from '../../ipc/runtime-environments/connectivity/runtime-environment-manual-disconnect'
import { subscribeRuntimeEnvironment } from '../../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { runtimeEnvironmentCall } from '../hosts/connected-runtime-hosts'
import type { FederationTransport } from './federation-transport'

/**
 * A paired server's runtime RPC. Every desktop socket declares `live-sessions.status.v2`
 * (`remoteRuntimeClientCapabilities`), so the feed carries the current status codes.
 */
export function runtimeFederationTransport(userDataPath: string): FederationTransport {
  return {
    call: runtimeEnvironmentCall(userDataPath),
    async subscribe(environmentId, method, params, handlers) {
      if (isRuntimeEnvironmentManuallyDisconnected(environmentId)) {
        throw new Error(RUNTIME_MANUALLY_DISCONNECTED_MESSAGE)
      }
      const subscription = await subscribeRuntimeEnvironment(
        userDataPath,
        environmentId,
        method,
        params,
        undefined,
        {
          onEvent: (payload) => {
            if (payload.type === 'response') {
              if (payload.response.ok === true) {
                handlers.onFrame(payload.response.result)
              } else {
                handlers.onError(payload.response.error)
              }
            } else if (payload.type === 'error') {
              handlers.onError({ code: payload.code, message: payload.message })
            } else if (payload.type === 'close') {
              handlers.onClose()
            }
          },
          onClose: () => handlers.onClose()
        },
        undefined,
        undefined,
        // A feed never wakes a stopped WSL host or a sleeping VM.
        { wslStart: 'never' }
      )
      return { close: () => subscription.close() }
    }
  }
}
