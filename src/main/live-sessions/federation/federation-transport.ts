import type { LiveSessionMachine } from '../../../shared/live-sessions/live-session-types'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'

export type FederatedServer = {
  /** The desktop's machine record for the server: its sessions are listed under it. */
  machine: LiveSessionMachine
  environmentId: string
}

/** Said of a session whose server has no feed open right now. */
export const SERVER_NOT_CONNECTED = 'This machine is not connected'

export type FederationStreamError = { code: string; message: string }

export type FederationTransport = {
  /** Opens a streaming RPC; `onFrame` gets each result frame. `onError` and `onClose` end it. */
  subscribe(
    environmentId: string,
    method: string,
    params: unknown,
    handlers: {
      onFrame(frame: unknown): void
      onError(error: FederationStreamError): void
      onClose(): void
    }
  ): Promise<{ close(): void }>
  call(
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ): Promise<RuntimeRpcResponse<unknown>>
}
