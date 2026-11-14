import type { LiveSessionService } from './live-session-service'

let instance: LiveSessionService | null = null

/** The running live-session service; null before the host starts it. */
export function getLiveSessionService(): LiveSessionService | null {
  return instance
}

export function setLiveSessionService(service: LiveSessionService | null): void {
  instance = service
}
