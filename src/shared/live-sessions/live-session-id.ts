import type { LiveSession } from './live-session-types'

export function liveSessionId(
  hostId: string,
  provider: LiveSession['provider'],
  providerSessionId: string
): string {
  return `${hostId}:${provider}:${providerSessionId}`
}

/** The cwd's last path segment. */
export function projectOf(cwd: string | null): string | null {
  if (!cwd) {
    return null
  }
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? null
}
