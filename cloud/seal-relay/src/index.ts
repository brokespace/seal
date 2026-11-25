import { z } from 'zod'
import edge from '../../../cloud/apps/relay-edge/src/index'
import { readBearer, verifyRelayJwt, HOST_ID } from '../../../cloud/apps/relay-edge/src/jwt'
import {
  admitPreAuth,
  decodePathSegment,
  notOnEdge
} from '../../../cloud/apps/relay-edge/src/preauth'
import { deriveHostFingerprint } from '../../../cloud/apps/push/src/host-auth/host-fingerprint'
import { SpliceRelay } from '../../../cloud/apps/relay-edge/src/splice-relay'
import { parseConnId } from '../../../cloud/apps/relay-edge/src/splice-slot'
import { PUSH_LIMITS } from '../../../cloud/packages/push-contract/src/push-limits'
import {
  PushHostChallengeRequestSchema,
  PushHostSessionRequestSchema
} from '../../../cloud/packages/push-contract/src/host-auth-messages'
import { PushDeviceRegistrationRequestSchema } from '../../../cloud/packages/push-contract/src/device-registration-messages'
import { PushSendRequestSchema } from '../../../cloud/packages/push-contract/src/send-messages'
import { RELAY_PROTOCOL_LIMITS } from '../../../cloud/packages/relay-contract/src/protocol-limits'
import { readCappedBody } from './capped-request-body'
import type { SealEnv } from './env'
import {
  challengeFingerprint,
  decodeHostPublicKey,
  fingerprintOfPublicKey,
  issueHostChallenge,
  mintHostSession,
  proofHash,
  verifyHostSession
} from './host-auth'
import { mintRelayToken, sealRelayUserId } from './relay-token'
import { SealHostRelay } from './seal-host-relay'
import { routeSealMcp } from './seal-mcp-routes'
import { SealMcpTunnel } from './seal-mcp-tunnel'
import { SealPushHost } from './seal-push-host'
import { hostEnrolled, sealRelayConfig } from './seal-relay-config'
import { admitKey, admitSource } from './source-rate-limit'

export { SealHostRelay, SpliceRelay, SealPushHost, SealMcpTunnel }

const RelayTokenRequestSchema = z.object({
  relayHostId: z.string().regex(HOST_ID),
  hostPublicKeyB64: z.string().max(64)
})
const AssignRequestSchema = z.object({ v: z.literal(1), relayHostId: z.string().regex(HOST_ID) })
const ResolveRequestSchema = z.object({
  v: z.literal(1),
  relayHostId: z.string().regex(HOST_ID),
  resumeToken: z.string().min(1).max(512)
})
// Phones re-resolve at most this often; there is only one cell to move to.
const RESOLVE_LEASE_MS = 10 * 60 * 1000
const RELAY_PATHS = /^\/(health|v1\/host\/control|v1\/connect\/[^/]+|v1\/host\/data\/[^/]+)$/

function status(code: number): Response {
  return new Response(null, { status: code })
}

type Body = { ok: true; value: unknown } | { ok: false; response: Response }

/** JSON no larger than `maxBytes`; the refusal otherwise (413 too large, 400 not JSON). */
async function readJson(request: Request, maxBytes: number): Promise<Body> {
  const text = await readCappedBody(request, maxBytes)
  if (text === null) {
    return { ok: false, response: status(413) }
  }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, response: status(400) }
  }
}

function pushHost(env: SealEnv, hostFingerprint: string): DurableObjectStub<SealPushHost> {
  return env.PUSH_HOSTS.get(env.PUSH_HOSTS.idFromName(hostFingerprint))
}

async function handleChallenge(env: SealEnv, request: Request, origin: string): Promise<Response> {
  if (!(await admitSource(env.HOST_AUTH_LIMITER, request))) {
    return status(429)
  }
  const json = await readJson(request, RELAY_PROTOCOL_LIMITS.maxHttpBodyBytes)
  if (!json.ok) {
    return json.response
  }
  const body = PushHostChallengeRequestSchema.safeParse(json.value)
  const hostPublicKey = body.success ? decodeHostPublicKey(body.data.hostPublicKeyB64) : null
  if (!hostPublicKey) {
    return status(400)
  }
  // Refused before any object exists for the key: strangers cost no storage.
  if (!hostEnrolled(env, deriveHostFingerprint(hostPublicKey))) {
    return status(403)
  }
  const issued = issueHostChallenge(origin, hostPublicKey)
  await pushHost(env, issued.hostFingerprint).storeChallenge(
    issued.response.challengeId,
    issued.pending
  )
  return Response.json(issued.response)
}

async function handleSession(env: SealEnv, request: Request): Promise<Response> {
  if (!(await admitSource(env.HOST_AUTH_LIMITER, request))) {
    return status(429)
  }
  const json = await readJson(request, RELAY_PROTOCOL_LIMITS.maxHttpBodyBytes)
  if (!json.ok) {
    return json.response
  }
  const body = PushHostSessionRequestSchema.safeParse(json.value)
  if (!body.success) {
    return status(400)
  }
  const hostFingerprint = challengeFingerprint(body.data.challengeId)
  const hash = proofHash(body.data.proofB64)
  if (!hostFingerprint || !hash) {
    return status(401)
  }
  if (!hostEnrolled(env, hostFingerprint)) {
    return status(403)
  }
  if (!(await pushHost(env, hostFingerprint).consumeChallenge(body.data.challengeId, hash))) {
    return status(401)
  }
  return Response.json(mintHostSession(env.HOST_SESSION_SECRET, hostFingerprint))
}

async function handleRelayToken(
  env: SealEnv,
  request: Request,
  hostFingerprint: string
): Promise<Response> {
  const json = await readJson(request, RELAY_PROTOCOL_LIMITS.maxHttpBodyBytes)
  if (!json.ok) {
    return json.response
  }
  const body = RelayTokenRequestSchema.safeParse(json.value)
  if (!body.success) {
    return status(400)
  }
  // The relay host id is the same key digest as the session's fingerprint.
  if (
    body.data.relayHostId !== hostFingerprint ||
    fingerprintOfPublicKey(body.data.hostPublicKeyB64) !== hostFingerprint
  ) {
    return status(403)
  }
  return Response.json(await mintRelayToken(env, hostFingerprint))
}

/** The relay JWT's host, or the refusal: 401 for a bad token, 403 for a host no longer enrolled. */
async function enrolledRelayHost(
  env: SealEnv,
  request: Request
): Promise<{ ok: true; relayHostId: string; userId: string } | { ok: false; response: Response }> {
  const token = readBearer(request.headers.get('authorization'))
  const verified = token ? await verifyRelayJwt(env, token) : null
  if (!verified?.ok) {
    return { ok: false, response: status(401) }
  }
  const { relayHostId, userId } = verified.claims
  if (userId !== sealRelayUserId(relayHostId) || !hostEnrolled(env, relayHostId)) {
    return { ok: false, response: status(403) }
  }
  return { ok: true, relayHostId, userId }
}

async function handleAssign(env: SealEnv, request: Request, origin: string): Promise<Response> {
  const host = await enrolledRelayHost(env, request)
  if (!host.ok) {
    return host.response
  }
  const { relayHostId, userId } = host
  if (!(await admitKey(env.HOST_API_LIMITER, relayHostId))) {
    return status(429)
  }
  const json = await readJson(request, RELAY_PROTOCOL_LIMITS.maxHttpBodyBytes)
  if (!json.ok) {
    return json.response
  }
  const body = AssignRequestSchema.safeParse(json.value)
  if (!body.success) {
    return status(400)
  }
  if (body.data.relayHostId !== relayHostId) {
    return status(403)
  }
  const relay = env.SEAL_HOST_RELAY.get(env.SEAL_HOST_RELAY.idFromName(relayHostId))
  const { assignmentEpoch } = await relay.sealAssign(userId, relayHostId, env.EDGE_CELL_ID ?? 'seal')
  // The desktop treats the lease as opaque; Seal has no director that would verify it.
  return Response.json({ v: 1, cellUrl: origin, assignmentEpoch, lease: `seal:${assignmentEpoch}` })
}

/**
 * Placement is told only to a phone that proves it is paired with the host. A host that is
 * unknown, not enrolled or not this phone's gets the same 401, so nobody can probe which hosts exist.
 */
async function handleResolve(env: SealEnv, request: Request, origin: string): Promise<Response> {
  if (!(await admitSource(env.HOST_AUTH_LIMITER, request, 'resolve:'))) {
    return status(429)
  }
  const json = await readJson(request, RELAY_PROTOCOL_LIMITS.maxHttpBodyBytes)
  if (!json.ok) {
    return json.response
  }
  const body = ResolveRequestSchema.safeParse(json.value)
  if (!body.success) {
    return status(400)
  }
  const { relayHostId, resumeToken } = body.data
  if (!hostEnrolled(env, relayHostId)) {
    return status(401)
  }
  const relay = env.SEAL_HOST_RELAY.get(env.SEAL_HOST_RELAY.idFromName(relayHostId))
  const placement = await relay.sealResolve(relayHostId, resumeToken, env.EDGE_CELL_ID ?? 'seal')
  if (!placement) {
    return status(401)
  }
  return Response.json({
    v: 1,
    cellUrl: origin,
    assignmentEpoch: placement.assignmentEpoch,
    leaseExpiresAt: Date.now() + RESOLVE_LEASE_MS
  })
}

async function handlePush(
  env: SealEnv,
  request: Request,
  path: string,
  hostFingerprint: string
): Promise<Response> {
  const host = pushHost(env, hostFingerprint)
  if (path === '/v1/devices' && request.method === 'GET') {
    return Response.json({ devices: await host.listDevices() })
  }
  if (path === '/v1/devices' && request.method === 'POST') {
    const json = await readJson(request, PUSH_LIMITS.maxHttpBodyBytes)
    if (!json.ok) {
      return json.response
    }
    const body = PushDeviceRegistrationRequestSchema.safeParse(json.value)
    if (!body.success) {
      return status(400)
    }
    const registered = await host.registerDevice(body.data)
    return registered ? Response.json(registered) : status(429)
  }
  const removal = /^\/v1\/devices\/([^/]{1,128})$/.exec(path)
  if (removal && request.method === 'DELETE') {
    const registrationId = decodePathSegment(removal[1])
    if (registrationId === null) {
      return status(400)
    }
    await host.removeDevice(registrationId)
    return status(204)
  }
  if (path === '/v1/send' && request.method === 'POST') {
    const json = await readJson(request, PUSH_LIMITS.maxHttpBodyBytes)
    if (!json.ok) {
      return json.response
    }
    const body = PushSendRequestSchema.safeParse(json.value)
    if (!body.success) {
      return status(400)
    }
    return Response.json({ results: await host.send(hostFingerprint, body.data) })
  }
  return status(404)
}

/**
 * The shared edge's socket paths, for enrolled hosts only. A host outside the allowlist is
 * answered here, before any of its objects is addressed.
 */
async function routeRelaySockets(
  env: SealEnv,
  request: Request,
  path: string
): Promise<Response> {
  const isUpgrade = request.headers.get('upgrade')?.toLowerCase() === 'websocket'
  if (path === '/v1/host/control') {
    const token = readBearer(request.headers.get('authorization'))
    const verified = token ? await verifyRelayJwt(env, token) : null
    // The edge answers a token it cannot verify; only a valid one for a de-listed host stops here.
    if (verified?.ok && !hostEnrolled(env, verified.claims.relayHostId)) {
      return status(403)
    }
    return edge.fetch(request, env)
  }
  const phone = /^\/v1\/connect\/([^/]+)$/.exec(path)
  if (phone && HOST_ID.test(phone[1]) && !hostEnrolled(env, phone[1])) {
    if (!(await admitPreAuth(env, request, 'phone'))) {
      return status(429)
    }
    // The answer an offline host gets, so a stranger cannot tell which hosts are enrolled.
    return isUpgrade ? notOnEdge() : status(426)
  }
  const data = /^\/v1\/host\/data\/([^/]+)$/.exec(path)
  if (data) {
    const connId = decodePathSegment(data[1])
    const parsed = connId === null ? null : parseConnId(connId)
    if (parsed && !hostEnrolled(env, parsed.relayHostId)) {
      return status(404)
    }
  }
  return edge.fetch(request, env)
}

async function route(request: Request, env: SealEnv): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  if (path === '/v1/host/challenge' && request.method === 'POST') {
    return handleChallenge(env, request, url.origin)
  }
  if (path === '/v1/host/session' && request.method === 'POST') {
    return handleSession(env, request)
  }
  if (path === '/v1/assign' && request.method === 'POST') {
    return handleAssign(env, request, url.origin)
  }
  if (path === '/v1/resolve' && request.method === 'POST') {
    return handleResolve(env, request, url.origin)
  }
  if (path === '/v1/host/relay-token' || path === '/v1/send' || path.startsWith('/v1/devices')) {
    const session = verifyHostSession(
      env.HOST_SESSION_SECRET,
      readBearer(request.headers.get('authorization'))
    )
    if (!session) {
      return status(401)
    }
    const { hostFingerprint } = session
    // Taking a host off the allowlist ends the sessions it already holds.
    if (!hostEnrolled(env, hostFingerprint)) {
      return status(403)
    }
    if (!(await admitKey(env.HOST_API_LIMITER, hostFingerprint))) {
      return status(429)
    }
    if (path === '/v1/host/relay-token' && request.method === 'POST') {
      return handleRelayToken(env, request, hostFingerprint)
    }
    return handlePush(env, request, path, hostFingerprint)
  }
  const mcp = await routeSealMcp(env, request, path)
  if (mcp) {
    return mcp
  }
  // The shared edge's admin and spike routes stay unreachable: only relay socket paths pass.
  if (RELAY_PATHS.test(path)) {
    return routeRelaySockets(env, request, path)
  }
  return status(404)
}

export default {
  async fetch(request: Request, env: SealEnv): Promise<Response> {
    try {
      sealRelayConfig(env)
    } catch (error) {
      // Only the name of the failed check: never a configured value.
      console.error(
        'seal relay refuses to serve:',
        error instanceof Error ? error.message : 'config'
      )
      return Response.json({ error: 'relay_misconfigured' }, { status: 503 })
    }
    return route(request, env)
  }
} satisfies ExportedHandler<SealEnv>
