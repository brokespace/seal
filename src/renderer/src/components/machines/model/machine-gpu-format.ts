import type {
  MachineGpu,
  MachineGpuSummary
} from '../../../../../shared/machines/machine-gpu-types'
import { formatBytes, formatBytesOfTotal } from './machine-format'

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

/** Everything one GPU reports, for the hover text of its compact cell. */
export function formatGpuReadings(gpu: MachineGpu): string {
  return [
    gpu.name,
    gpu.utilizationPercent === null ? null : formatGpuPercent(gpu.utilizationPercent),
    gpu.memoryUsedBytes === null && gpu.memoryTotalBytes === null
      ? null
      : formatGpuMemory(gpu.memoryUsedBytes, gpu.memoryTotalBytes),
    gpu.temperatureC === null ? null : `${Math.round(gpu.temperatureC)} °C`,
    gpu.powerDrawWatts === null ? null : formatGpuWatts(gpu.powerDrawWatts)
  ]
    .filter(Boolean)
    .join(' · ')
}
