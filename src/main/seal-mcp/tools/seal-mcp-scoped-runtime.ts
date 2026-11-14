import type { HomeChatAssistantServices } from '../../home-chat/home-chat-assistant-services'
import { resolveHomeChatMachineId } from '../../home-chat/machines/home-chat-machine-provider'
import type { HomeChatMachineProvider } from '../../home-chat/machines/home-chat-machine-types'
import type { HomeChatSessionAccess } from '../../home-chat/seal/home-chat-session-access'
import type { HomeChatToolContext } from '../../home-chat/tools/home-chat-tool-context'

/** What the MCP tools run on: the Home assistant's machines and services, and Seal's runtime RPC. */
export type SealMcpToolRuntime = {
  machines: HomeChatMachineProvider
  services: HomeChatAssistantServices
  runOrcaCli: HomeChatToolContext['runOrcaCli']
  /** Call one of this Seal server's RPC methods in-process, as its owner. */
  callRpc: (method: string, params?: unknown) => Promise<unknown>
}

export class SealMcpMachineDeniedError extends Error {
  constructor(machine: string) {
    super(`This MCP client is not allowed to use the machine "${machine}".`)
    this.name = 'SealMcpMachineDeniedError'
  }
}

function scopeMachines(
  provider: HomeChatMachineProvider,
  allowed: ReadonlySet<string>
): HomeChatMachineProvider {
  const list: HomeChatMachineProvider['list'] = async () =>
    (await provider.list()).filter((machine) => allowed.has(machine.id))
  return {
    list,
    open: async (query) => {
      // Resolving against the allowed machines keeps the others out of error messages too.
      const id = resolveHomeChatMachineId(query, await list())
      if (!allowed.has(id)) {
        throw new SealMcpMachineDeniedError(query)
      }
      return provider.open(id)
    }
  }
}

function scopeSessions(
  sessions: HomeChatSessionAccess,
  allowed: ReadonlySet<string>
): HomeChatSessionAccess {
  const list: HomeChatSessionAccess['list'] = async () => {
    const all = await sessions.list()
    // Scan errors name machines, so a restricted client is not told about them.
    return { sessions: all.sessions.filter((s) => allowed.has(s.machineId)), errors: [] }
  }
  const requireVisible = async (sessionId: string): Promise<void> => {
    if (!(await list()).sessions.some((session) => session.id === sessionId)) {
      throw new Error(`No session ${sessionId}. Call list_sessions and use an id from it.`)
    }
  }
  return {
    list,
    transcript: async (sessionId, limit) => {
      await requireVisible(sessionId)
      return sessions.transcript(sessionId, limit)
    },
    send: async (sessionId, text) => {
      await requireVisible(sessionId)
      return sessions.send(sessionId, text)
    }
  }
}

/** Narrow a runtime to a client's machine allowlist; null leaves every machine reachable. */
export function scopeSealMcpToolRuntime(
  runtime: SealMcpToolRuntime,
  machines: readonly string[] | null
): SealMcpToolRuntime {
  if (!machines) {
    return runtime
  }
  const allowed = new Set(machines)
  return {
    ...runtime,
    machines: scopeMachines(runtime.machines, allowed),
    services: {
      ...runtime.services,
      seal: {
        ...runtime.services.seal,
        sessions: scopeSessions(runtime.services.seal.sessions, allowed)
      }
    }
  }
}
