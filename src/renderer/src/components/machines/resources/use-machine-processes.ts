import { useCallback, useEffect, useState } from 'react'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import type { MachineProcessSnapshot } from '../../../../../shared/machines/machine-resource-types'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import { recordMachineGpuSamples } from '../model/machine-gpu-history'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'

/** Each sample takes about a second on the machine, so this leaves it mostly idle. */
const REFRESH_MS = 3_000

export type MachineProcessesState = {
  snapshot: MachineProcessSnapshot | null
  error: string | null
  /** Samples at once, e.g. after a signal, instead of waiting for the next round. */
  sampleNow: () => void
}

/** Samples the machine's processes for as long as a view showing them is open; `gpus` adds its GPUs. */
export function useMachineProcesses(machineId: MachineId, gpus = false): MachineProcessesState {
  const [snapshot, setSnapshot] = useState<MachineProcessSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sampleCount, setSampleCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    let sampling = false
    const sample = (): void => {
      if (sampling) {
        return
      }
      sampling = true
      void machineResourceApi()
        .listProcesses(gpus ? { machineId, gpus } : { machineId })
        .then((next) => {
          if (!cancelled) {
            if (next.gpu) {
              recordMachineGpuSamples(machineId, next.gpu.gpus, next.collectedAt)
            }
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
    const stop = installWindowVisibilityInterval({ run: sample, intervalMs: REFRESH_MS })
    return () => {
      cancelled = true
      stop()
    }
  }, [machineId, gpus, sampleCount])

  const sampleNow = useCallback(() => setSampleCount((count) => count + 1), [])
  return { snapshot, error, sampleNow }
}
