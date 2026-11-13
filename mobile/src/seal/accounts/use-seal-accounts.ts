import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useHostQuery } from '../../query/host-query'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import {
  mutateSealAccounts,
  readSealAccountsWithUsage,
  SEAL_ACCOUNTS_INPUT,
  SEAL_ACCOUNTS_TARGET,
  sealAccountsStatusKey,
  sealAccountsStatusQuery,
  type SealAccountsMutation
} from './seal-accounts-operations'

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The host's account status, refetched every 30 s while `poll` (as desktop's settings pane does). */
export function useSealAccounts(hostId: string, client: RpcClient | null, poll: boolean) {
  const queryClient = useQueryClient()
  const query = useHostQuery(
    sealAccountsStatusQuery,
    { hostId, client },
    SEAL_ACCOUNTS_TARGET,
    SEAL_ACCOUNTS_INPUT,
    { refetchInterval: poll ? 30_000 : false }
  )
  // Which control is waiting on the host, so only it shows busy.
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mutate = useCallback(
    async (busyKey: string, mutation: SealAccountsMutation) => {
      if (!client) {
        return
      }
      setBusy(busyKey)
      setError(null)
      try {
        await mutateSealAccounts(queryClient, { hostId, client }, mutation)
      } catch (err) {
        setError(errorText(err))
      } finally {
        setBusy(null)
      }
    },
    [client, hostId, queryClient]
  )

  const refreshUsage = useCallback(async () => {
    if (!client) {
      return
    }
    try {
      queryClient.setQueryData(
        sealAccountsStatusKey(hostId),
        await readSealAccountsWithUsage(client)
      )
    } catch (err) {
      setError(errorText(err))
    }
  }, [client, hostId, queryClient])

  return {
    status: query.data ?? null,
    loadError: query.error,
    refetch: query.refetch,
    busy,
    error,
    clearError: () => setError(null),
    mutate,
    refreshUsage
  }
}
