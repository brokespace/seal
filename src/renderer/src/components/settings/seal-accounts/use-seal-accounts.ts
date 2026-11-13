import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type { SealAccountsStatus } from '../../../../../shared/seal-accounts/seal-accounts-status'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'

const POLL_MS = 30_000

export type SealAccountsMutation = (
  method: string,
  params: unknown,
  failureMessage: string
) => Promise<boolean>

function statusFrom(result: unknown): SealAccountsStatus | null {
  if (!result || typeof result !== 'object') {
    return null
  }
  if ('providers' in result && 'config' in result) {
    return result as SealAccountsStatus
  }
  return 'status' in result ? statusFrom((result as { status: unknown }).status) : null
}

/** Live Seal account status for one host; every mutation returns fresh status from that host. */
export function useSealAccounts(target: RuntimeClientTarget): {
  status: SealAccountsStatus | null
  error: string | null
  refreshing: boolean
  refresh: (refreshUsage?: boolean) => Promise<void>
  mutate: SealAccountsMutation
} {
  const [status, setStatus] = useState<SealAccountsStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const targetKey = target.kind === 'local' ? 'local' : target.environmentId
  const targetRef = useRef(target)
  targetRef.current = target

  const refresh = useCallback(async (refreshUsage = false) => {
    setRefreshing(true)
    try {
      const result = await callRuntimeRpc<SealAccountsStatus>(
        targetRef.current,
        'seal.accounts.status',
        { refreshUsage },
        { timeoutMs: 30_000 }
      )
      setStatus(result)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    setStatus(null)
    void refresh(true)
    const timer = setInterval(() => void refresh(false), POLL_MS)
    return () => clearInterval(timer)
  }, [refresh, targetKey])

  const mutate = useCallback<SealAccountsMutation>(
    async (method, params, failureMessage) => {
      try {
        const result = await callRuntimeRpc<unknown>(targetRef.current, method, params, {
          timeoutMs: 60_000
        })
        const next = statusFrom(result)
        if (next) {
          setStatus(next)
        } else {
          await refresh(false)
        }
        return true
      } catch (caught) {
        toast.error(failureMessage, {
          description: caught instanceof Error ? caught.message : String(caught)
        })
        return false
      }
    },
    [refresh]
  )

  return { status, error, refreshing, refresh, mutate }
}
