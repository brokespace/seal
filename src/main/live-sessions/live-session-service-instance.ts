import type { LiveSessionService } from './live-session-service'

let instance: LiveSessionService | null = null

/** The running live-session service; null before startup and in orcad, which has no Electron app. */
export function getLiveSessionService(): LiveSessionService | null {
  return instance
}

export function setLiveSessionService(service: LiveSessionService | null): void {
  instance = service
}
