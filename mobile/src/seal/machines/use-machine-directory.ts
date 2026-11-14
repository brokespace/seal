import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { readHostQueryLive, useHostQuery } from '../../query/host-query'
import { hostQueryKey } from '../../query/host-query-key'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import {
  machineDirectoryHasMore,
  machineDirectoryQuery,
  machineQueryTarget,
  readMachineDirectory,
  readNextMachineDirectoryPage
} from './machine-operations'
import type { MobileMachineDirListing } from './machine-reply-schemas'

/** One folder's listing: cached rows paint first, a host-cached reply is re-read fresh, more rows load on scroll. */
export function useMachineDirectory(args: {
  hostId: string
  client: RpcClient | null
  machineId: string
  path: string
}) {
  const { hostId, client, machineId, path } = args
  const queryClient = useQueryClient()
  const target = useMemo(() => machineQueryTarget(machineId), [machineId])
  const input = useMemo(() => ({ path }), [path])
  const listing = useHostQuery(machineDirectoryQuery, { hostId, client }, target, input)
  const [revalidating, setRevalidating] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const revalidatedFor = useRef<string | null>(null)

  const queryKey = useMemo(
    () => hostQueryKey(hostId, machineDirectoryQuery.family, target, input),
    [hostId, input, target]
  )

  // Skips the host's own listing cache: pull-to-refresh, and after a change made from this phone.
  const refresh = useCallback(async () => {
    if (!client) {
      return
    }
    setRevalidating(true)
    try {
      await readHostQueryLive(
        queryClient,
        machineDirectoryQuery,
        { hostId, client },
        target,
        input,
        {
          replace: true,
          read: () =>
            readMachineDirectory(
              client,
              machineId,
              path,
              queryClient.getQueryData<MobileMachineDirListing>(queryKey),
              true
            )
        }
      )
      setPageError(null)
    } catch {
      // The listing keeps its rows; the query's own error state reports a folder that never loaded.
    } finally {
      setRevalidating(false)
    }
  }, [client, hostId, input, machineId, path, queryClient, queryKey, target])

  const fromCache = listing.data?.fromCache === true
  useEffect(() => {
    const scope = `${hostId}\n${machineId}\n${path}`
    if (fromCache && client && revalidatedFor.current !== scope) {
      revalidatedFor.current = scope
      void refresh()
    }
  }, [client, fromCache, hostId, machineId, path, refresh])

  const loadMore = useCallback(async () => {
    const current = queryClient.getQueryData<MobileMachineDirListing>(queryKey)
    if (!client || loadingMore || !current || !machineDirectoryHasMore(current)) {
      return
    }
    setLoadingMore(true)
    try {
      const next = await readNextMachineDirectoryPage(client, machineId, current)
      if (next) {
        queryClient.setQueryData(queryKey, next)
      }
      setPageError(null)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingMore(false)
    }
  }, [client, loadingMore, machineId, queryClient, queryKey])

  return { listing, refresh, revalidating, loadMore, loadingMore, pageError }
}
