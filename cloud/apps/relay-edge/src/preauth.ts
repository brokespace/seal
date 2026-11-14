// Limits on sockets that have not authenticated yet (phone connects, host data sockets), and on
// the unauthenticated object health probe (health.ts). Desktops
// authenticate with a relay JWT before the upgrade; phones and data sockets prove a credential in
// their first frame, so until then they are only bounded here.
import { RELAY_CLOSE_CODE } from '../../../packages/relay-contract/src/close-codes'
import { RELAY_PROTOCOL_LIMITS } from '../../../packages/relay-contract/src/protocol-limits'
import { sourceAddressKey } from '../../../../src/shared/source-address-key'
import { edgeConfig, type Env } from './env'
import { metric, requestPlace } from './metrics'

// The caller's address as Cloudflare saw it (clients cannot set this header), keyed per IPv6 /64.
export function sourceKey(request: Request): string {
  return sourceAddressKey(request.headers.get('cf-connecting-ip'))
}

// Counted per source per colo by the Rate Limiting binding. A limiter outage fails open: it must
// not refuse live users. A deploy without the binding refuses instead (only spike runs go unlimited).
export async function admitPreAuth(env: Env, request: Request, kind: 'phone' | 'data' | 'health'): Promise<boolean> {
  if (!env.PREAUTH_LIMITER) { return edgeConfig(env).backend === 'spike' }
  try {
    const { success } = await env.PREAUTH_LIMITER.limit({ key: `${kind}:${sourceKey(request)}` })
    if (!success) { metric(env, 'preauth_limited', 1, kind, [], '', requestPlace(request)) }
    return success
  } catch {
    return true
  }
}

export const FIRST_FRAME_TIMEOUT_REASON = 'first frame timeout'

// A percent-escape a client mangled is its error (400), not an unhandled exception (500).
export function decodePathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

// A phone dialled the edge for a host the director never pushed (or one already wiped): answer
// from the Worker without creating any object storage. WRONG_CELL sends the phone back to the
// director, as a cell does for a host it does not hold; it never reads as a revoked credential.
export function notOnEdge(): Response {
  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
  server.accept()
  const timer = setTimeout(() => {
    try {
      // Not 4401: a socket that sent nothing says nothing about any credential.
      server.close(RELAY_CLOSE_CODE.PEER_DROPPED, FIRST_FRAME_TIMEOUT_REASON)
    } catch {}
  }, RELAY_PROTOCOL_LIMITS.firstFrameDeadlineMs)
  server.addEventListener(
    'message',
    () => {
      clearTimeout(timer)
      try {
        server.send(JSON.stringify({ type: 'relay-hello', ok: false, code: RELAY_CLOSE_CODE.WRONG_CELL }))
        server.close(RELAY_CLOSE_CODE.WRONG_CELL, 'host not on this cell')
      } catch {}
    },
    { once: true }
  )
  server.addEventListener('close', () => clearTimeout(timer))
  return new Response(null, { status: 101, webSocket: client })
}
