import { useCallback, useEffect, useRef } from 'react'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { SEAL_PROVIDERS } from '../../../../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountsStatus } from '../../../../../shared/seal-accounts/seal-accounts-status'
import { hasUsageData } from '../../../../../shared/agent-usage/display/usage-provider-windows'
import { mutateSealHost, refreshSealHost } from '../../seal-session/seal-session-status-store'
import { useSealHostState } from '../../seal-session/use-seal-host-snapshot'

/** A first usage reading follows a sign-in or import by seconds; re-read until it shows. */
const FIRST_READING_POLL_MS = 2_000
const FIRST_READING_POLLS = 10

export type SealAccountsMutation = (
  method: string,
  params: unknown,
  failureMessage: string
) => Promise<boolean>

/** The logins still waiting for their first usage reading, as one comparable string. */
function awaitingFirstReading(status: SealAccountsStatus): string {
  return SEAL_PROVIDERS.flatMap((provider) => status.providers[provider].candidates)
    .filter(
      ({ kind, launchable, authFailure, health, limits }) =>
        kind !== 'api-key' &&
        launchable &&
        !authFailure &&
        health?.state !== 'dead' &&
        (!limits || (!hasUsageData(limits) && !limits.error))
    )
    .map((candidate) => candidate.key)
    .join('\n')
}

/**
 * A view of one host's accounts over the status every other view of that host shares. Opening
 * it asks the host for fresh usage, and every mutation shows the status the host answers with.
 */
export function useSealAccounts(target: RuntimeClientTarget): {
  status: SealAccountsStatus | null
  /** When the shown status was read; reset countdowns are measured from it. */
  readAt: number
  error: string | null
  refreshing: boolean
  refresh: (refreshUsage?: boolean) => Promise<void>
  mutate: SealAccountsMutation
} {
  const { snapshot, error, refreshing } = useSealHostState(target)

  const refresh = useCallback(
    (refreshUsage = false) => refreshSealHost(target, refreshUsage ? 'requested' : 'none'),
    [target]
  )

  useEffect(() => {
    void refreshSealHost(target, 'on-open')
  }, [target])

  const awaiting = snapshot ? awaitingFirstReading(snapshot.status) : ''
  const readAt = snapshot?.readAt ?? 0
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
      void refreshSealHost(target)
    }, FIRST_READING_POLL_MS)
    return () => clearTimeout(timer)
  }, [awaiting, readAt, target])

  const mutate = useCallback<SealAccountsMutation>(
    (method, params, failureMessage) => mutateSealHost(target, method, params, failureMessage),
    [target]
  )

  return { status: snapshot?.status ?? null, readAt, error, refreshing, refresh, mutate }
}
