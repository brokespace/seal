import type {
  SealMcpClient,
  SealMcpSettings,
  SealMcpTransport
} from '../../shared/seal-mcp/seal-mcp-types'
import { SealMcpRateLimiter } from './limits/seal-mcp-rate-limiter'

const FAILED_SIGN_INS_PER_MINUTE = 20

/** Where a request came from, as the transport that carried it saw it. */
export type SealMcpPeer = { transport: SealMcpTransport; remote: string | null }

export type SealMcpAdmission =
  | { ok: true; client: SealMcpClient }
  | { ok: false; reason: 'disabled' | 'unauthorized' | 'throttled'; retryAfterSeconds: number }

export type SealMcpAdmissionDeps = {
  settings: () => SealMcpSettings
  authenticate: (token: string | null | undefined) => SealMcpClient | null
  refused: (peer: SealMcpPeer, client: SealMcpClient | null, detail: string) => void
}

/** Who gets in: the transport must be switched on, the token valid, and the peer not guessing. */
export class SealMcpAdmissionDoor {
  private readonly failedSignIns = new SealMcpRateLimiter()

  constructor(private readonly deps: SealMcpAdmissionDeps) {}

  admit(token: string | null | undefined, peer: SealMcpPeer): SealMcpAdmission {
    const settings = this.deps.settings()
    const closed =
      (peer.transport === 'http' && !settings.httpEnabled) ||
      (peer.transport === 'relay' && !settings.relayEnabled)
    if (closed) {
      return { ok: false, reason: 'disabled', retryAfterSeconds: 0 }
    }
    const peerKey = `${peer.transport}:${peer.remote ?? 'unknown'}`
    const wait = this.failedSignIns.retryAfter(peerKey, FAILED_SIGN_INS_PER_MINUTE)
    if (wait > 0) {
      return { ok: false, reason: 'throttled', retryAfterSeconds: wait }
    }
    const client = this.deps.authenticate(token)
    const refusal = !client
      ? 'No valid client token.'
      : peer.transport === 'relay' && !client.allowRelay
        ? 'This client is not allowed to connect through the relay.'
        : null
    if (!client || refusal) {
      this.failedSignIns.take(peerKey, FAILED_SIGN_INS_PER_MINUTE)
      this.deps.refused(peer, client, refusal ?? '')
      return { ok: false, reason: 'unauthorized', retryAfterSeconds: 0 }
    }
    return { ok: true, client }
  }
}
