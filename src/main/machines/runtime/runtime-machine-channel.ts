import {
  isRuntimeEnvironmentManuallyDisconnected,
  RUNTIME_MANUALLY_DISCONNECTED_MESSAGE
} from '../../ipc/runtime-environments/runtime-environment-manual-disconnect'
import {
  callRuntimeEnvironment,
  subscribeRuntimeEnvironment
} from '../../ipc/runtime-environments/runtime-environment-transport-routing'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import {
  parseMachineHostStreamEvent,
  type MachineHostStreamEvent
} from '../../../shared/machines/machine-host-wire'

export type RuntimeMachineStreamHandlers = {
  onEvent: (event: MachineHostStreamEvent) => void
  /** Transport failure or a handler error; the stream is over. */
  onError: (message: string) => void
  onClose: () => void
}

/** The paired runtime's RPC socket, narrowed to what the Machines tab needs. */
export type RuntimeMachineChannel = {
  call(method: string, params: unknown, timeoutMs: number): Promise<unknown>
  stream(
    method: string,
    params: unknown,
    handlers: RuntimeMachineStreamHandlers
  ): Promise<{ close: () => void }>
}

export const RUNTIME_OUTDATED_MESSAGE =
  'Update Seal on this runtime to manage its files and stats from Machines'

/** Older runtimes lack `machineHost.*`; say what to do instead of "Unknown method". */
export function runtimeMachineError(error: { code: string; message: string }): Error {
  return new Error(error.code === 'method_not_found' ? RUNTIME_OUTDATED_MESSAGE : error.message)
}

export function unwrapRuntimeMachineResponse(response: RuntimeRpcResponse<unknown>): unknown {
  if (response.ok !== true) {
    throw runtimeMachineError(response.error)
  }
  return response.result
}

function assertConnected(environmentId: string): void {
  if (isRuntimeEnvironmentManuallyDisconnected(environmentId)) {
    throw new Error(RUNTIME_MANUALLY_DISCONNECTED_MESSAGE)
  }
}

export function createRuntimeMachineChannel(
  userDataPath: string,
  environmentId: string
): RuntimeMachineChannel {
  return {
    async call(method, params, timeoutMs) {
      assertConnected(environmentId)
      return unwrapRuntimeMachineResponse(
        await callRuntimeEnvironment(userDataPath, environmentId, method, params, timeoutMs)
      )
    },
    async stream(method, params, handlers) {
      assertConnected(environmentId)
      let finished = false
      const finish = (report: () => void): void => {
        if (!finished) {
          finished = true
          report()
        }
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
              if (payload.response.ok !== true) {
                const message = runtimeMachineError(payload.response.error).message
                finish(() => handlers.onError(message))
                return
              }
              const event = parseMachineHostStreamEvent(payload.response.result)
              if (event) {
                handlers.onEvent(event)
              }
            } else if (payload.type === 'error') {
              const message = runtimeMachineError(payload).message
              finish(() => handlers.onError(message))
            } else if (payload.type === 'close') {
              finish(handlers.onClose)
            }
          },
          onClose: () => finish(handlers.onClose)
        }
      )
      return { close: () => subscription.close() }
    }
  }
}
