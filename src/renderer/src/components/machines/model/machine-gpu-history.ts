import { useSyncExternalStore } from 'react'
import type { MachineGpu } from '../../../../../shared/machines/machine-gpu-types'
import type { MachineId } from '../../../../../shared/machines/machine-types'

/** About three minutes at the detail's sampling rate. */
const HISTORY_SAMPLES = 60
/** A longer pause than this would draw as one step, so the line starts over. */
const HISTORY_GAP_MS = 30_000

export type MachineGpuHistory = {
  /** Null entries are samples where the driver reported no figure. */
  utilizationPercent: (number | null)[]
  memoryUsedPercent: (number | null)[]
}

type MachineHistory = { lastAt: number; byGpu: ReadonlyMap<number, MachineGpuHistory> }

let histories: ReadonlyMap<MachineId, MachineHistory> = new Map()
const listeners = new Set<() => void>()
const NO_HISTORY: ReadonlyMap<number, MachineGpuHistory> = new Map()

function appended<T>(samples: readonly T[], sample: T): T[] {
  return [...samples, sample].slice(-HISTORY_SAMPLES)
}

export function machineGpuMemoryPercent(gpu: MachineGpu): number | null {
  return gpu.memoryUsedBytes !== null && gpu.memoryTotalBytes
    ? Math.min(100, (gpu.memoryUsedBytes / gpu.memoryTotalBytes) * 100)
    : null
}

/** Adds one sample per GPU; history lives outside the view so reopening it keeps the line. */
export function recordMachineGpuSamples(
  machineId: MachineId,
  gpus: readonly MachineGpu[],
  collectedAt: number
): void {
  const previous = histories.get(machineId)
  if (previous && collectedAt <= previous.lastAt) {
    return
  }
  const continues = previous !== undefined && collectedAt - previous.lastAt <= HISTORY_GAP_MS
  const byGpu = new Map<number, MachineGpuHistory>()
  for (const gpu of gpus) {
    const before = continues ? previous.byGpu.get(gpu.index) : undefined
    byGpu.set(gpu.index, {
      utilizationPercent: appended(before?.utilizationPercent ?? [], gpu.utilizationPercent),
      memoryUsedPercent: appended(before?.memoryUsedPercent ?? [], machineGpuMemoryPercent(gpu))
    })
  }
  histories = new Map(histories).set(machineId, { lastAt: collectedAt, byGpu })
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useMachineGpuHistory(machineId: MachineId): ReadonlyMap<number, MachineGpuHistory> {
  return useSyncExternalStore(subscribe, () => {
    const history = histories.get(machineId)
    // Samples from before a long pause are not drawn while the next one is on its way.
    return history && Date.now() - history.lastAt <= HISTORY_GAP_MS ? history.byGpu : NO_HISTORY
  })
}
