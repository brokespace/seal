import type { NetworkProxySettings } from '../../../../shared/network-proxy'

export type CodexRateLimitFetchOptions = {
  codexHomePath?: string | null
  networkProxySettings?: NetworkProxySettings
  signal?: AbortSignal
  /** Read usage over HTTP first, so the short-lived `codex app-server` probe is only the fallback. */
  preferBackend?: boolean
}
