const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return '—'
  }
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`
}

/** Used share of a capacity, 0–100, or null when either side is unknown. */
export function usedPercent(total: number | null, available: number | null): number | null {
  if (total === null || available === null || total <= 0) {
    return null
  }
  return Math.min(100, Math.max(0, ((total - available) / total) * 100))
}

/** 1-minute load as a share of all cores, else the host's sampled busy %, which Windows reports instead. */
export function cpuLoadPercent(
  loadAverage: [number, number, number] | null,
  cpuCount: number | null,
  cpuUsagePercent: number | null = null
): number | null {
  if (!loadAverage || !cpuCount || cpuCount <= 0) {
    return cpuUsagePercent === null ? null : Math.min(100, Math.max(0, cpuUsagePercent))
  }
  return Math.min(100, Math.max(0, (loadAverage[0] / cpuCount) * 100))
}

export function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds < 0) {
    return '—'
  }
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

export function transferPercent(transferred: number, total: number | null): number | null {
  if (total === null || total <= 0) {
    return null
  }
  return Math.min(100, (transferred / total) * 100)
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  svg: 'image/svg+xml'
}

export type MachinePreviewKind = 'image' | 'pdf' | 'markdown' | 'text' | 'binary'

export function previewKindFor(name: string): { kind: MachinePreviewKind; mimeType?: string } {
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  if (IMAGE_EXTENSIONS[extension]) {
    return { kind: 'image', mimeType: IMAGE_EXTENSIONS[extension] }
  }
  if (extension === 'pdf') {
    return { kind: 'pdf', mimeType: 'application/pdf' }
  }
  if (extension === 'md' || extension === 'markdown' || extension === 'mdx') {
    return { kind: 'markdown' }
  }
  return { kind: 'text' }
}

/** NUL bytes in the first 8 KB mean the file is not text worth showing in an editor. */
export function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192)
  return sample.includes(0)
}
