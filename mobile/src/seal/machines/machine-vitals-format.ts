import { getUiIntlLocale } from '../../i18n/ui-intl-locale'
import type { MobileMachineMetrics } from './machine-reply-schemas'

export type MachineVitals = {
  cpuPercent: number | null
  memoryPercent: number | null
  diskPercent: number | null
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function usedPercent(total: number | null, available: number | null): number | null {
  return total === null || available === null || total <= 0
    ? null
    : clampPercent(((total - available) / total) * 100)
}

// 1-minute load per core, else the sampled busy %, which Windows reports instead of a load average.
export function machineVitals(metrics: MobileMachineMetrics): MachineVitals {
  const { loadAverage, cpuCount, cpuUsagePercent } = metrics
  const cpuPercent =
    loadAverage && cpuCount && cpuCount > 0
      ? clampPercent((loadAverage[0] / cpuCount) * 100)
      : cpuUsagePercent === null
        ? null
        : clampPercent(cpuUsagePercent)
  return {
    cpuPercent,
    memoryPercent: usedPercent(metrics.memTotalBytes, metrics.memAvailableBytes),
    diskPercent: usedPercent(metrics.diskTotalBytes, metrics.diskAvailableBytes)
  }
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export function formatMachineBytes(bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toLocaleString(getUiIntlLocale(), { maximumFractionDigits: digits })} ${BYTE_UNITS[unit]}`
}

/** Compact uptime: `3d 4h`, `5h 12m`, `9m`. */
export function formatMachineUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

export function machineOsLabel(os: MobileMachineMetrics['os']): string | null {
  switch (os) {
    case 'darwin':
      return 'macOS'
    case 'linux':
      return 'Linux'
    case 'win32':
      return 'Windows'
    case null:
      return null
  }
}
