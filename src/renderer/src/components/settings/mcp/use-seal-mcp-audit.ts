import { useCallback, useEffect, useRef, useState } from 'react'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type { SealMcpAuditEntry } from '../../../../../shared/seal-mcp/seal-mcp-types'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { watchSealMcp } from '@/components/seal-mcp/seal-mcp-watch-feed'
import { sealMcpErrorText } from './use-seal-mcp'

const PAGE_SIZE = 50

export type SealMcpAuditState = {
  entries: SealMcpAuditEntry[]
  phase: 'loading' | 'ready' | 'error'
  error: string | null
  /** The last page came back full, so older entries may exist. */
  hasOlder: boolean
  loadingOlder: boolean
}

const INITIAL: SealMcpAuditState = {
  entries: [],
  phase: 'loading',
  error: null,
  hasOlder: false,
  loadingOlder: false
}

function listAudit(
  target: RuntimeClientTarget,
  clientId: string | null,
  before?: number
): Promise<SealMcpAuditEntry[]> {
  return callRuntimeRpc<{ entries: SealMcpAuditEntry[] }>(
    target,
    'sealMcp.listAudit',
    {
      limit: PAGE_SIZE,
      ...(clientId ? { clientId } : {}),
      ...(before === undefined ? {} : { before })
    },
    { timeoutMs: 30_000 }
  ).then((result) => result.entries)
}

/** Newest first, without the entries the list already holds. */
function mergeAudit(held: SealMcpAuditEntry[], incoming: SealMcpAuditEntry[]): SealMcpAuditEntry[] {
  const known = new Set(held.map((entry) => entry.id))
  const fresh = incoming.filter((entry) => !known.has(entry.id))
  return fresh.length ? [...held, ...fresh].sort((a, b) => b.at - a.at) : held
}

/**
 * One server's MCP audit log, newest first: paged backwards, and extended live while shown.
 * Remount it (a `key`) for another server or client filter; it never mixes two lists.
 */
export function useSealMcpAudit(
  target: RuntimeClientTarget,
  clientId: string | null
): SealMcpAuditState & { loadOlder: () => void } {
  const [state, setState] = useState<SealMcpAuditState>(INITIAL)
  // Replies that land after unmount are dropped.
  const listSeq = useRef(0)

  useEffect(() => {
    const seq = ++listSeq.current
    const live = (): boolean => listSeq.current === seq
    const readNewest = (): void => {
      void listAudit(target, clientId).then(
        (entries) => {
          if (live()) {
            setState((current) => ({
              ...current,
              entries: mergeAudit(current.entries, entries),
              phase: 'ready',
              error: null,
              // A re-read after a reconnect must not hide a Load older the first read offered.
              hasOlder: current.hasOlder || entries.length === PAGE_SIZE
            }))
          }
        },
        (caught: unknown) => {
          if (live()) {
            setState((current) =>
              current.phase === 'ready'
                ? current
                : { ...current, phase: 'error', error: sealMcpErrorText(caught) }
            )
          }
        }
      )
    }
    readNewest()
    const stop = watchSealMcp(target, (event) => {
      if (!live()) {
        return
      }
      if (event.type === 'attached') {
        readNewest()
      } else if (event.type === 'audit' && (!clientId || event.entry.clientId === clientId)) {
        setState((current) => ({
          ...current,
          entries: mergeAudit(current.entries, [event.entry])
        }))
      }
    })
    return () => {
      listSeq.current += 1
      stop()
    }
  }, [target, clientId])

  const oldest = state.entries.at(-1)?.at
  const loadOlder = useCallback(() => {
    if (oldest === undefined) {
      return
    }
    const seq = listSeq.current
    setState((current) => ({ ...current, loadingOlder: true }))
    // Why + 1: `before` is exclusive, and entries written in the same millisecond must not be skipped.
    void listAudit(target, clientId, oldest + 1).then(
      (entries) => {
        if (listSeq.current === seq) {
          setState((current) => ({
            ...current,
            entries: mergeAudit(current.entries, entries),
            hasOlder: entries.length === PAGE_SIZE,
            loadingOlder: false
          }))
        }
      },
      (caught: unknown) => {
        if (listSeq.current === seq) {
          setState((current) => ({
            ...current,
            loadingOlder: false,
            error: sealMcpErrorText(caught)
          }))
        }
      }
    )
  }, [target, clientId, oldest])

  return { ...state, loadOlder }
}
