import type { WebSocket } from 'ws'
import type { DeviceEntry } from '../server/pairing/device-entry'
import type { DeviceRegistry } from '../server/pairing/device-registry'
import type { AuthenticatedMobileSocket } from './mobile-socket-wiring'

// A second bounds how long a socket outlives its device's revocation or credential expiry.
const REVOCATION_SWEEP_INTERVAL_MS = 1000

type RevocationSweepOptions = {
  deviceRegistry: DeviceRegistry
  authenticatedSockets: () => [WebSocket, AuthenticatedMobileSocket][]
  closeUnauthorized: (ws: WebSocket) => void
  /** Rows removed from the registry file by another writer, or expired: the owner finishes the revoke. */
  onDevicesRevoked?: (devices: DeviceEntry[]) => void
}

/** A silent socket sends nothing to recheck its device on, so revocation is also enforced on a timer. */
export class RevocationSweep {
  private readonly timer: ReturnType<typeof setInterval>
  private failing = false

  constructor(private readonly options: RevocationSweepOptions) {
    this.timer = setInterval(() => this.run(Date.now()), REVOCATION_SWEEP_INTERVAL_MS)
    // Why: bookkeeping must never hold the process open.
    this.timer.unref?.()
  }

  stop(): void {
    clearInterval(this.timer)
  }

  run(now: number): void {
    const { deviceRegistry } = this.options
    try {
      const revoked = deviceRegistry.takeRevokedDevices(now)
      if (revoked.length > 0) {
        this.options.onDevicesRevoked?.(revoked)
      }
      this.failing = false
    } catch (error) {
      if (!this.failing) {
        console.error('[mobile] Failed to finish revoking removed or expired devices:', error)
      }
      this.failing = true
    }
    for (const [ws, socket] of this.options.authenticatedSockets()) {
      if (!deviceRegistry.resolveAuthenticatedPrincipal(socket.device)) {
        this.options.closeUnauthorized(ws)
        // A revoked peer may ignore the close frame; do not wait for its reply.
        ws.terminate()
      }
    }
  }
}
