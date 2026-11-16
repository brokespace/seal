import type {
  MachineGpu,
  MachineGpuSummary
} from '../../../../../shared/machines/machine-gpu-types'
import { formatBytes, formatBytesOfTotal, formatTemperature } from './machine-format'

export function formatGpuPercent(percent: number | null): string {
  return percent === null ? '—' : `${Math.round(percent)}%`
}

/** `19.9 / 24.0 GB`, or just what is in use where the GPU has no memory of its own. */
export function formatGpuMemory(used: number | null, total: number | null): string {
  return used === null || total === null
    ? formatBytes(used ?? total)
    : formatBytesOfTotal(used, total)
}

export function formatGpuWatts(watts: number | null): string {
  return watts === null ? '—' : `${Math.round(watts)} W`
}

/** Average utilization and memory across a machine's GPUs, the figures every overview leads with. */
export function formatGpuSummary(summary: MachineGpuSummary): string {
  return [
    summary.utilizationPercent === null ? null : formatGpuPercent(summary.utilizationPercent),
    summary.memoryUsedBytes === null && summary.memoryTotalBytes === null
      ? null
      : formatGpuMemory(summary.memoryUsedBytes, summary.memoryTotalBytes)
  ]
    .filter(Boolean)
    .join(' · ')
}

/** `0–3, 6`: the GPUs a process is on, with runs of neighbours folded so eight fit in one tag. */
export function formatGpuIndexes(indexes: readonly number[]): string {
  const runs: string[] = []
  for (let start = 0; start < indexes.length;) {
    let end = start
    while (indexes[end + 1] === indexes[end] + 1) {
      end++
    }
    runs.push(
      end > start + 1
        ? `${indexes[start]}–${indexes[end]}`
        : indexes.slice(start, end + 1).join(', ')
    )
    start = end + 1
  }
  return runs.join(', ')
}

/** Everything one GPU reports, for the hover text of its compact cell. */
export function formatGpuReadings(gpu: MachineGpu): string {
  return [
    gpu.name,
    gpu.utilizationPercent === null ? null : formatGpuPercent(gpu.utilizationPercent),
    gpu.memoryUsedBytes === null && gpu.memoryTotalBytes === null
      ? null
      : formatGpuMemory(gpu.memoryUsedBytes, gpu.memoryTotalBytes),
    gpu.temperatureC === null ? null : formatTemperature(gpu.temperatureC),
    gpu.powerDrawWatts === null ? null : formatGpuWatts(gpu.powerDrawWatts)
  ]
    .filter(Boolean)
    .join(' · ')
}
