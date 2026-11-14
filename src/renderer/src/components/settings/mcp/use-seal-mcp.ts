import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type {
  SealMcpClient,
  SealMcpClientCreateArgs,
  SealMcpClientCreated,
  SealMcpMachine,
  SealMcpSettings,
  SealMcpStatus
} from '../../../../../shared/seal-mcp/seal-mcp-types'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import { watchSealMcp } from '@/components/seal-mcp/seal-mcp-watch-feed'

export type SealMcpSnapshot = { status: SealMcpStatus; clients: SealMcpClient[] }

export type SealMcpLoad =
  | { phase: 'loading' }
  /** `readAt` is when the snapshot was read; "last used" times are measured from it. */
  | { phase: 'ready'; snapshot: SealMcpSnapshot; readAt: number }
  /** The server is older than the MCP server and has none of its methods. */
  | { phase: 'unsupported' }
  | { phase: 'error'; message: string }

export function sealMcpErrorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

async function loadSnapshot(target: RuntimeClientTarget): Promise<SealMcpLoad> {
  try {
    const { status, clients } = await callRuntimeRpc<SealMcpSnapshot>(
      target,
      'sealMcp.status',
      undefined,
      { timeoutMs: 30_000 }
    )
    return { phase: 'ready', snapshot: { status, clients }, readAt: Date.now() }
  } catch (caught) {
    if (caught instanceof RuntimeRpcCallError && caught.code === 'method_not_found') {
      return { phase: 'unsupported' }
    }
    return { phase: 'error', message: sealMcpErrorText(caught) }
  }
}

/** One Seal server's MCP endpoints and clients, re-read whenever that server says they changed. */
export function useSealMcp(target: RuntimeClientTarget): {
  load: SealMcpLoad
  machines: SealMcpMachine[] | null
  retry: () => void
  loadMachines: () => void
  updateSettings: (patch: Partial<SealMcpSettings>, failureMessage: string) => Promise<boolean>
  /** The token in the result exists only here; the caller shows it once and drops it. */
  createClient: (
    args: SealMcpClientCreateArgs,
    failureMessage: string
  ) => Promise<SealMcpClientCreated | null>
  revokeClient: (clientId: string, failureMessage: string) => Promise<boolean>
  removeClient: (clientId: string, failureMessage: string) => Promise<boolean>
} {
  const [load, setLoad] = useState<SealMcpLoad>({ phase: 'loading' })
  const [machines, setMachines] = useState<SealMcpMachine[] | null>(null)
  const readSeq = useRef(0)

  const refresh = useCallback(async () => {
    const seq = ++readSeq.current
    const next = await loadSnapshot(target)
    // Only the newest read lands; a failed re-read keeps the page that is already showing.
    if (seq === readSeq.current) {
      setLoad((current) => (current.phase === 'ready' && next.phase === 'error' ? current : next))
    }
  }, [target])

  useEffect(() => {
    void refresh()
    const stop = watchSealMcp(target, (event) => {
      if (
        event.type === 'attached' ||
        event.type === 'clients' ||
        event.type === 'settings' ||
        event.type === 'status'
      ) {
        void refresh()
      }
    })
    return () => {
      // A read still in flight belongs to a server this page no longer shows.
      readSeq.current += 1
      stop()
    }
  }, [refresh, target])

  const loadMachines = useCallback(() => {
    void callRuntimeRpc<{ machines: SealMcpMachine[] }>(target, 'sealMcp.listMachines', undefined, {
      timeoutMs: 30_000
    }).then(
      (result) => setMachines(result.machines),
      () => setMachines([])
    )
  }, [target])

  const mutate = useCallback(
    async <T>(method: string, params: unknown, failureMessage: string): Promise<T | null> => {
      try {
        const result = await callRuntimeRpc<T>(target, method, params, { timeoutMs: 30_000 })
        await refresh()
        return result
      } catch (caught) {
        toast.error(failureMessage, { description: sealMcpErrorText(caught) })
        return null
      }
    },
    [refresh, target]
  )

  return {
    load,
    machines,
    retry: () => {
      setLoad({ phase: 'loading' })
      void refresh()
    },
    loadMachines,
    updateSettings: async (patch, failureMessage) =>
      (await mutate('sealMcp.updateSettings', patch, failureMessage)) !== null,
    createClient: (args, failureMessage) =>
      mutate<SealMcpClientCreated>('sealMcp.createClient', args, failureMessage),
    revokeClient: async (clientId, failureMessage) =>
      (await mutate('sealMcp.revokeClient', { clientId }, failureMessage)) !== null,
    removeClient: async (clientId, failureMessage) =>
      (await mutate('sealMcp.removeClient', { clientId }, failureMessage)) !== null
  }
}
