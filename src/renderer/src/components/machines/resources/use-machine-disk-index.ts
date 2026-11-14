import { useCallback, useEffect, useRef, useState } from 'react'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import type {
  MachineDiskIndexRequest,
  MachineDiskIndexStatus
} from '../../../../../shared/machines/machine-disk-index-types'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import { requestDiskIndexStatus, resourceErrorText } from './machine-resource-requests'

/** Often enough that scan progress reads as live. */
const SCANNING_REFRESH_MS = 2_500
/** Between scans only the age and free space move. */
const IDLE_REFRESH_MS = 10_000

type DiskIndexCommand = Exclude<MachineDiskIndexRequest, { op: 'list' | 'largest' | 'status' }>

export type MachineDiskIndexState = {
  status: MachineDiskIndexStatus | null
  /** This computer's clock when `status` arrived, to age the machine's own timestamps. */
  receivedAt: number
  error: string | null
  /** Changes the index (rescan, include a disk) and shows the status that comes back. */
  send: (request: DiskIndexCommand) => Promise<void>
}

/** Follows a machine's disk index for as long as the disk panel is open. */
export function useMachineDiskIndex(machineId: MachineId): MachineDiskIndexState {
  const [state, setState] = useState<{ status: MachineDiskIndexStatus; receivedAt: number } | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)

  const request = useCallback(
    async (command: DiskIndexCommand | { op: 'status' }): Promise<void> => {
      const round = ++latest.current
      try {
        const status = await requestDiskIndexStatus(machineId, command)
        if (round === latest.current) {
          setState({ status, receivedAt: Date.now() })
          setError(null)
        }
      } catch (err) {
        if (round === latest.current) {
          setError(resourceErrorText(err))
        }
      }
    },
    [machineId]
  )

  const scanning =
    state === null ||
    state.status.scan !== null ||
    state.status.mounts.some((mount) => mount.indexed && mount.scannedAt === null)

  useEffect(() => {
    let asking = false
    return installWindowVisibilityInterval({
      run: () => {
        if (asking) {
          return
        }
        asking = true
        void request({ op: 'status' }).finally(() => {
          asking = false
        })
      },
      intervalMs: scanning ? SCANNING_REFRESH_MS : IDLE_REFRESH_MS
    })
  }, [request, scanning])

  return {
    status: state?.status ?? null,
    receivedAt: state?.receivedAt ?? 0,
    error,
    send: request
  }
}
