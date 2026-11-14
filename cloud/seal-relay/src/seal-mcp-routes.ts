import { HOST_ID, readBearer } from '../../../cloud/apps/relay-edge/src/jwt'
import {
  SEAL_MCP_RELAY_HOST_PATH,
  SEAL_MCP_RELAY_PUBLIC_PREFIX
} from '../../../src/shared/seal-mcp/seal-mcp-relay-frames'
import type { SealEnv } from './env'
import { verifyHostSession } from './host-auth'

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
    const hostFingerprint = verifyHostSession(
      env.HOST_SESSION_SECRET,
      readBearer(request.headers.get('authorization'))
    )
    return hostFingerprint ? tunnel(env, hostFingerprint).fetch(request) : status(401)
  }
  if (!path.startsWith(SEAL_MCP_RELAY_PUBLIC_PREFIX)) {
    return null
  }
  const hostId = path.slice(SEAL_MCP_RELAY_PUBLIC_PREFIX.length)
  if (!HOST_ID.test(hostId)) {
    return status(404)
  }
  if (!FORWARDED_METHODS.has(request.method)) {
    return status(405, { allow: 'POST' })
  }
  // A request that cannot be a Seal client is turned away here, without waking the host.
  if (!CLIENT_TOKEN.test(readBearer(request.headers.get('authorization')) ?? '')) {
    return status(401, { 'www-authenticate': 'Bearer realm="seal-mcp"' })
  }
  const source = request.headers.get('cf-connecting-ip') ?? 'local'
  if (env.MCP_LIMITER && !(await env.MCP_LIMITER.limit({ key: `${hostId}:${source}` })).success) {
    return status(429, { 'retry-after': '30' })
  }
  return tunnel(env, hostId).fetch(request)
}
