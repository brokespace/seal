/** 0.4s, 12s, 1m 05s: short enough for a tool row. */
export function formatHomeChatDuration(ms: number): string {
  if (ms < 10_000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) {
    return `${seconds}s`
  }
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

export function formatHomeChatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** 12.4k, 200k, 1M: token counts for the context meter. */
export function formatHomeChatTokens(tokens: number): string {
  if (tokens < 1000) {
    return String(Math.max(0, Math.round(tokens)))
  }
  if (tokens < 1_000_000) {
    const thousands = tokens / 1000
    return `${thousands < 100 ? thousands.toFixed(1).replace(/\.0$/, '') : Math.round(thousands)}k`
  }
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** now, 5m, 3h, 2d: how long ago a thread was last touched. */
export function formatHomeChatAge(at: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) {
    return 'now'
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}
