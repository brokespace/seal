import { useCallback, useEffect, useState } from 'react'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import type { MachineProcessSnapshot } from '../../../../../shared/machines/machine-resource-types'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'

/** Each sample takes about a second on the machine, so this leaves it mostly idle. */
const REFRESH_MS = 3_000

export type MachineProcessesState = {
  snapshot: MachineProcessSnapshot | null
  error: string | null
  paused: boolean
  setPaused: (paused: boolean) => void
  refresh: () => void
}

/** Samples the machine's processes for as long as a view showing them is open. */
export function useMachineProcesses(machineId: MachineId): MachineProcessesState {
  const [snapshot, setSnapshot] = useState<MachineProcessSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [refreshCount, setRefreshCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    let sampling = false
    const sample = (): void => {
      if (sampling) {
        return
      }
      sampling = true
      void machineResourceApi()
        .listProcesses({ machineId })
        .then((next) => {
          if (!cancelled) {
            setSnapshot(next)
            setError(null)
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(resourceErrorText(err))
          }
        })
        .finally(() => {
          sampling = false
        })
    }
    if (paused) {
      // A paused view still answers Refresh and reloads after a signal, once.
      if (refreshCount > 0) {
        sample()
      }
      return () => {
        cancelled = true
      }
    }
    const stop = installWindowVisibilityInterval({ run: sample, intervalMs: REFRESH_MS })
    return () => {
      cancelled = true
      stop()
    }
  }, [machineId, paused, refreshCount])

  const refresh = useCallback(() => setRefreshCount((count) => count + 1), [])
  return { snapshot, error, paused, setPaused, refresh }
}
