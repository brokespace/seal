import type { MachineMetrics } from '../machines/machine-types'

type LoadReadings = Pick<MachineMetrics, 'loadAverage' | 'cpuCount' | 'cpuUsagePercent'>
type MemoryReadings = Pick<MachineMetrics, 'memTotalBytes' | 'memAvailableBytes'>
type DiskReadings = Pick<MachineMetrics, 'diskTotalBytes' | 'diskAvailableBytes'>

function percentOf(used: number, total: number): number {
  return Math.max(0, Math.min(100, (used / total) * 100))
}

/** 1-minute load average per core (1 = fully busy), else the instant CPU share; undefined when unknown. */
export function machineLoad(metrics: LoadReadings | null | undefined): number | undefined {
  if (metrics?.loadAverage && metrics.cpuCount) {
    return metrics.loadAverage[0] / metrics.cpuCount
  }
  if (metrics?.cpuUsagePercent != null) {
    return metrics.cpuUsagePercent / 100
  }
  return undefined
}

export function machineMemoryUsedPercent(
  metrics: MemoryReadings | null | undefined
): number | undefined {
  return metrics?.memTotalBytes && metrics.memAvailableBytes != null
    ? percentOf(metrics.memTotalBytes - metrics.memAvailableBytes, metrics.memTotalBytes)
    : undefined
}

export function machineDiskUsedPercent(
  metrics: DiskReadings | null | undefined
): number | undefined {
  return metrics?.diskTotalBytes && metrics.diskAvailableBytes != null
    ? percentOf(metrics.diskTotalBytes - metrics.diskAvailableBytes, metrics.diskTotalBytes)
    : undefined
}
