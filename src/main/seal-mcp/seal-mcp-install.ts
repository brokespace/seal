import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import type { SealMcpApprovalRequest } from '../../shared/seal-mcp/seal-mcp-types'
import { requireHomeChat } from '../home-chat/home-chat-install'
import { getRuntimeDesktopSurface } from '../runtime/construction/runtime-desktop-surface'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { LOCAL_CLI_RPC_CALLER } from '../runtime/rpc/callers/rpc-caller-identity'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { ALL_RPC_METHODS } from '../runtime/rpc/methods/rpc-method-registry'
import { SealMcpService } from './seal-mcp-service'
import { setSealMcpService } from './seal-mcp-service-instance'

/**
 * Tells the person a call is waiting, wherever they are. The notice names who and what, never the
 * arguments: it leaves this machine through the OS and the phone's push service.
 */
function announceApprovalRequest(
  runtime: OrcaRuntimeService,
  request: SealMcpApprovalRequest
): void {
  const title = 'Seal: MCP approval needed'
  const where = request.machine ? ` on ${request.machine}` : ''
  const body = `${request.clientName} wants to use ${request.tool}${where}.`
  try {
    getRuntimeDesktopSurface().showNotification({ title, body })
  } catch {
    // A headless server has no desktop to notify.
  }
  runtime.dispatchMobileNotification({
    type: 'notification',
    source: 'plugin',
    emittedAt: Date.now(),
    title,
    body
  })
}

let installed = false

/**
 * One MCP server per host process, on the desktop app and on the headless server alike. Its tools
 * are the Home assistant's tools and Seal's RPC methods, called in-process as this host's owner.
 */
export function installSealMcp(runtime: OrcaRuntimeService): void {
  if (installed) {
    return
  }
  installed = true
  const dispatcher = new RpcDispatcher({ runtime, methods: ALL_RPC_METHODS })
  const callRpc = async (method: string, params?: unknown): Promise<unknown> => {
    const response = await dispatcher.dispatch(
      { id: randomUUID(), authToken: 'seal-mcp', method, params },
      { caller: LOCAL_CLI_RPC_CALLER }
    )
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    return response.result
  }
  const service = new SealMcpService({
    dir: join(getAppEnvironment().getPath('userData'), 'mcp'),
    version: getAppEnvironment().getVersion(),
    runtime: async () => ({ ...(await requireHomeChat()).toolRuntime(), callRpc })
  })
  service.onEvent((event) => {
    if (event.type === 'approval-requested') {
      announceApprovalRequest(runtime, event.request)
    }
  })
  // Published only once its clients and settings are read, so nothing can act on an empty store.
  void service.start().then(() => setSealMcpService(service))
  getAppEnvironment().onWillQuit(() => {
    void service.stop()
  })
}
