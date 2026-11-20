import { HOST_ID, readBearer } from '../../../cloud/apps/relay-edge/src/jwt'
import { sourceKey } from '../../../cloud/apps/relay-edge/src/preauth'
import {
  SEAL_MCP_RELAY_HOST_PATH,
  SEAL_MCP_RELAY_MAX_BODY_BYTES,
  SEAL_MCP_RELAY_PUBLIC_PREFIX
} from '../../../src/shared/seal-mcp/seal-mcp-relay-frames'
import { readCappedBody } from './capped-request-body'
import type { SealEnv } from './env'
import { verifyHostSession } from './host-auth'
import { hostEnrolled } from './seal-relay-config'
import { admitKey } from './source-rate-limit'

const FORWARDED_METHODS: ReadonlySet<string> = new Set(['POST', 'GET', 'DELETE'])
/** The shape of a Seal MCP client token. The relay cannot tell a real one from a made-up one. */
const CLIENT_TOKEN = /^smcp_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/

function status(code: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: code, headers })
}

function tunnel(env: SealEnv, hostFingerprint: string): DurableObjectStub {
  return env.MCP_TUNNEL.get(env.MCP_TUNNEL.idFromName(hostFingerprint))
}

/**
 * Seal's MCP endpoint for cloud clients: `/mcp/<relayHostId>` is passed down the WebSocket that
 * host dialed out. The relay terminates TLS, so it can read these requests; it stores and logs
 * none of them, and the host alone decides whether a token is valid and what it may do.
 */
export async function routeSealMcp(
  env: SealEnv,
  request: Request,
  path: string
): Promise<Response | null> {
  if (path === SEAL_MCP_RELAY_HOST_PATH) {
    const session = verifyHostSession(
      env.HOST_SESSION_SECRET,
      readBearer(request.headers.get('authorization'))
    )
    if (!session) {
      return status(401)
    }
    if (!hostEnrolled(env, session.hostFingerprint)) {
      return status(403)
    }
    if (!(await admitKey(env.HOST_API_LIMITER, session.hostFingerprint))) {
      return status(429, { 'retry-after': '30' })
    }
    return tunnel(env, session.hostFingerprint).fetch(request)
  }
  if (!path.startsWith(SEAL_MCP_RELAY_PUBLIC_PREFIX)) {
    return null
  }
  const hostId = path.slice(SEAL_MCP_RELAY_PUBLIC_PREFIX.length)
  // A host that is not enrolled has no object to wake, and looks like no host at all.
  if (!HOST_ID.test(hostId) || !hostEnrolled(env, hostId)) {
    return status(404)
  }
  if (!FORWARDED_METHODS.has(request.method)) {
    return status(405, { allow: 'POST' })
  }
  // A request that cannot be a Seal client is turned away here, without waking the host.
  if (!CLIENT_TOKEN.test(readBearer(request.headers.get('authorization')) ?? '')) {
    return status(401, { 'www-authenticate': 'Bearer realm="seal-mcp"' })
  }
  if (!(await admitKey(env.MCP_LIMITER, `${hostId}:${sourceKey(request)}`))) {
    return status(429, { 'retry-after': '30' })
  }
  // Read here, not in the host's object: a slow or oversized upload never takes one of its seats.
  const body =
    request.method === 'POST' ? await readCappedBody(request, SEAL_MCP_RELAY_MAX_BODY_BYTES) : ''
  if (body === null) {
    return Response.json({ error: 'body_too_large' }, { status: 413 })
  }
  return tunnel(env, hostId).fetch(
    new Request(request.url, {
      method: request.method,
      headers: request.headers,
      signal: request.signal,
      ...(request.method === 'POST' ? { body } : {})
    })
  )
}
