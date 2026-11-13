import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { toast } from 'sonner'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type { SealAccountsStatus } from '../../../../../shared/seal-accounts/seal-accounts-status'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'

const POLL_MS = 30_000

export type SealAccountsMutation = (
  method: string,
  params: unknown,
  failureMessage: string
) => Promise<boolean>

type Snapshot = { status: SealAccountsStatus; at: number }

function isSealAccountsStatus(value: unknown): value is SealAccountsStatus {
  return typeof value === 'object' && value !== null && 'providers' in value
}

/** Mutations answer with fresh status, either bare or as `{ status }` beside their own result. */
function statusFrom(result: unknown): SealAccountsStatus | null {
  if (isSealAccountsStatus(result)) {
    return result
  }
  if (typeof result === 'object' && result !== null && 'status' in result) {
    return isSealAccountsStatus(result.status) ? result.status : null
  }
  return null
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

async function loadStatus(
  target: RuntimeClientTarget,
  refreshUsage: boolean
): Promise<{ status: SealAccountsStatus } | { error: string }> {
  try {
    return {
      status: await callRuntimeRpc<SealAccountsStatus>(
        target,
        'seal.accounts.status',
        { refreshUsage },
        { timeoutMs: 30_000 }
      )
    }
  } catch (caught) {
    return { error: errorText(caught) }
  }
}

/** Live Seal account status for one host; every mutation returns fresh status from that host. */
export function useSealAccounts(target: RuntimeClientTarget): {
  status: SealAccountsStatus | null
  /** When the shown status was read; reset countdowns are measured from it. */
  readAt: number
  error: string | null
  refreshing: boolean
  refresh: (refreshUsage?: boolean) => Promise<void>
  mutate: SealAccountsMutation
} {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(
    async (refreshUsage = false) => {
      setRefreshing(true)
      const result = await loadStatus(target, refreshUsage)
      setRefreshing(false)
      if ('status' in result) {
        setSnapshot({ status: result.status, at: Date.now() })
        setError(null)
      } else {
        setError(result.error)
      }
    },
    [target]
  )

  const poll = useEffectEvent((refreshUsage: boolean) => void refresh(refreshUsage))
  useEffect(() => {
    poll(true)
    return installWindowVisibilityInterval({
      run: () => poll(false),
      intervalMs: POLL_MS,
      slowWhileUnfocused: true
    })
  }, [])

  const mutate = useCallback<SealAccountsMutation>(
    async (method, params, failureMessage) => {
      try {
        const result = await callRuntimeRpc<unknown>(target, method, params, { timeoutMs: 60_000 })
        const next = statusFrom(result)
        if (next) {
          setSnapshot({ status: next, at: Date.now() })
        } else {
          await refresh(false)
        }
        return true
      } catch (caught) {
        toast.error(failureMessage, { description: errorText(caught) })
        return false
      }
    },
    [refresh, target]
  )

  return {
    status: snapshot?.status ?? null,
    readAt: snapshot?.at ?? 0,
    error,
    refreshing,
    refresh,
    mutate
  }
}
