import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import { SEAL_PROVIDERS } from '../../../../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountsStatus } from '../../../../../shared/seal-accounts/seal-accounts-status'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'

const POLL_MS = 30_000
/** A first usage reading follows a sign-in or import by seconds; re-read until it shows. */
const FIRST_READING_POLL_MS = 2_000
const FIRST_READING_POLLS = 10

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

/** The logins still waiting for their first usage reading, as one comparable string. */
function awaitingFirstReading(status: SealAccountsStatus): string {
  return SEAL_PROVIDERS.flatMap((provider) => status.providers[provider].candidates)
    .filter(
      ({ kind, launchable, authFailure, health, usage }) =>
        kind !== 'api-key' &&
        launchable &&
        !authFailure &&
        health?.state !== 'dead' &&
        (!usage || (!usage.session && !usage.weekly && !usage.error))
    )
    .map((candidate) => candidate.key)
    .join('\n')
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

  const awaiting = snapshot ? awaitingFirstReading(snapshot.status) : ''
  const readAt = snapshot?.at ?? 0
  const firstReading = useRef({ awaiting: '', polls: 0 })
  useEffect(() => {
    if (firstReading.current.awaiting !== awaiting) {
      firstReading.current = { awaiting, polls: 0 }
    }
    if (!awaiting || firstReading.current.polls >= FIRST_READING_POLLS) {
      return
    }
    const timer = setTimeout(() => {
      firstReading.current.polls += 1
      poll(false)
    }, FIRST_READING_POLL_MS)
    return () => clearTimeout(timer)
  }, [awaiting, readAt])

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
    readAt,
    error,
    refreshing,
    refresh,
    mutate
  }
}
