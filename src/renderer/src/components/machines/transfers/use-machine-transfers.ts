import { useCallback, useEffect, useState } from 'react'
import type { MachineTransfer } from '../../../../../shared/machines/machine-types'

/** Live transfer list: one snapshot on mount, then main's progress pushes. */
export function useMachineTransfers(): {
  transfers: MachineTransfer[]
  clearFinished: () => void
} {
  const [transfers, setTransfers] = useState<MachineTransfer[]>([])
  useEffect(() => {
    const api = window.api.machines
    if (!api) {
      return
    }
    let cancelled = false
    void api
      .listTransfers()
      .then((list) => {
        if (!cancelled) {
          setTransfers(list)
        }
      })
      .catch(() => {})
    const unsubscribe = api.onTransferUpdated((transfer) => {
      setTransfers((previous) => {
        const index = previous.findIndex((t) => t.id === transfer.id)
        if (index === -1) {
          return [...previous, transfer]
        }
        const next = [...previous]
        next[index] = transfer
        return next
      })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  const clearFinished = useCallback(() => {
    setTransfers((previous) => previous.filter((transfer) => transfer.status === 'running'))
    void window.api.machines?.clearFinishedTransfers()
  }, [])
  return { transfers, clearFinished }
}
