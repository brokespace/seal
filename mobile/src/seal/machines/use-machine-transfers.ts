import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { HOST_LIST_TARGET, NO_HOST_LIST_INPUT } from '../../host-screen/catalog/host-list-queries'
import { useHostQuery } from '../../query/host-query'
import { hostQueryKey } from '../../query/host-query-key'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { cancelMachineTransfer, machineTransfersQuery } from './machine-operations'
import type { MobileMachineTransfer } from './machine-reply-schemas'

const POLL_MS = 1_000

/** The machine's host-side transfers: running ones, plus finished ones this screen started until cleared. */
export function useMachineTransfers(args: {
  hostId: string
  client: RpcClient | null
  machineId: string
  onFinished: (transfer: MobileMachineTransfer) => void
}) {
  const { hostId, client, machineId, onFinished } = args
  const queryClient = useQueryClient()
  const [started, setStarted] = useState<ReadonlySet<string>>(new Set())
  const cached = queryClient.getQueryData<MobileMachineTransfer[]>(
    hostQueryKey(hostId, machineTransfersQuery.family, HOST_LIST_TARGET, NO_HOST_LIST_INPUT)
  )
  const polling =
    (cached ?? []).some(
      (transfer) =>
        transfer.machineId === machineId &&
        transfer.direction !== 'download' &&
        transfer.status === 'running'
    ) || hasUnsettled(cached, started)
  const query = useHostQuery(
    machineTransfersQuery,
    { hostId, client },
    HOST_LIST_TARGET,
    NO_HOST_LIST_INPUT,
    { refetchInterval: polling ? POLL_MS : false }
  )

  const transfers = useMemo(
    () =>
      (query.data ?? []).filter(
        (transfer) =>
          transfer.machineId === machineId &&
          transfer.direction !== 'download' &&
          (transfer.status === 'running' || started.has(transfer.id))
      ),
    [machineId, query.data, started]
  )

  const statuses = useRef(new Map<string, MobileMachineTransfer['status']>())
  const onFinishedRef = useRef(onFinished)
  useEffect(() => {
    onFinishedRef.current = onFinished
  }, [onFinished])
  useEffect(() => {
    for (const transfer of transfers) {
      const before = statuses.current.get(transfer.id)
      statuses.current.set(transfer.id, transfer.status)
      if (before === 'running' && transfer.status !== 'running') {
        onFinishedRef.current(transfer)
      } else if (before === undefined && transfer.status === 'done' && started.has(transfer.id)) {
        // Finished before the first poll saw it running.
        onFinishedRef.current(transfer)
      }
    }
  }, [started, transfers])

  const track = useCallback(
    (transfer: MobileMachineTransfer) => {
      setStarted((previous) => new Set(previous).add(transfer.id))
      queryClient.setQueryData<MobileMachineTransfer[]>(
        hostQueryKey(hostId, machineTransfersQuery.family, HOST_LIST_TARGET, NO_HOST_LIST_INPUT),
        (previous) => [transfer, ...(previous ?? []).filter((item) => item.id !== transfer.id)]
      )
      if (transfer.status === 'running') {
        statuses.current.set(transfer.id, 'running')
      }
    },
    [hostId, queryClient]
  )

  const clearFinished = useCallback(() => {
    setStarted(
      (previous) =>
        new Set(
          [...previous].filter((id) =>
            transfers.some((transfer) => transfer.id === id && transfer.status === 'running')
          )
        )
    )
  }, [transfers])

  const cancel = useCallback(
    async (transferId: string) => {
      if (client) {
        await cancelMachineTransfer(client, transferId)
        await query.refetch()
      }
    },
    [client, query]
  )

  return { transfers, track, clearFinished, cancel }
}

function hasUnsettled(
  cached: MobileMachineTransfer[] | undefined,
  started: ReadonlySet<string>
): boolean {
  return [...started].some((id) => {
    const transfer = cached?.find((item) => item.id === id)
    return transfer === undefined || transfer.status === 'running'
  })
}
