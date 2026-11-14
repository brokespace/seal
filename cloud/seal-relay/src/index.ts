import { z } from 'zod'
import edge from '../../../cloud/apps/relay-edge/src/index'
import { readBearer, verifyRelayJwt, HOST_ID } from '../../../cloud/apps/relay-edge/src/jwt'
import { SpliceRelay } from '../../../cloud/apps/relay-edge/src/splice-relay'
import { PUSH_LIMITS } from '../../../cloud/packages/push-contract/src/push-limits'
import {
  PushHostChallengeRequestSchema,
  PushHostSessionRequestSchema
} from '../../../cloud/packages/push-contract/src/host-auth-messages'
import { PushDeviceRegistrationRequestSchema } from '../../../cloud/packages/push-contract/src/device-registration-messages'
import { PushSendRequestSchema } from '../../../cloud/packages/push-contract/src/send-messages'
import type { SealEnv } from './env'
import {
  challengeFingerprint,
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

async function readJson(request: Request): Promise<unknown> {
  if (request.method !== 'POST') {
    return undefined
  }
  const length = Number(request.headers.get('content-length') ?? '0')
  if (length > PUSH_LIMITS.maxHttpBodyBytes) {
    return undefined
  }
  const text = await request.text()
  if (text.length > PUSH_LIMITS.maxHttpBodyBytes) {
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

async function admitHostAuth(env: SealEnv, request: Request): Promise<boolean> {
  if (!env.HOST_AUTH_LIMITER) {
    return true
  }
  const key = request.headers.get('cf-connecting-ip') ?? 'local'
  return (await env.HOST_AUTH_LIMITER.limit({ key })).success
}

function pushHost(env: SealEnv, hostFingerprint: string): DurableObjectStub<SealPushHost> {
  return env.PUSH_HOSTS.get(env.PUSH_HOSTS.idFromName(hostFingerprint))
}

async function handleChallenge(env: SealEnv, request: Request, origin: string): Promise<Response> {
  if (!(await admitHostAuth(env, request))) {
    return status(429)
  }
  const body = PushHostChallengeRequestSchema.safeParse(await readJson(request))
  if (!body.success) {
    return status(400)
  }
  const issued = issueHostChallenge(origin, body.data.hostPublicKeyB64)
  if (!issued) {
    return status(400)
  }
  await pushHost(env, issued.hostFingerprint).storeChallenge(
    issued.response.challengeId,
    issued.pending
  )
  return Response.json(issued.response)
}

async function handleSession(env: SealEnv, request: Request): Promise<Response> {
  if (!(await admitHostAuth(env, request))) {
    return status(429)
  }
  const body = PushHostSessionRequestSchema.safeParse(await readJson(request))
  if (!body.success) {
    return status(400)
  }
  const hostFingerprint = challengeFingerprint(body.data.challengeId)
  const hash = proofHash(body.data.proofB64)
  if (!hostFingerprint || !hash) {
    return status(401)
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
  const body = RelayTokenRequestSchema.safeParse(await readJson(request))
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

async function handleAssign(env: SealEnv, request: Request, origin: string): Promise<Response> {
  const token = readBearer(request.headers.get('authorization'))
  const verified = token ? await verifyRelayJwt(env, token) : null
  if (!verified?.ok) {
    return status(401)
  }
  const body = AssignRequestSchema.safeParse(await readJson(request))
  if (!body.success) {
    return status(400)
  }
  const { relayHostId, userId } = verified.claims
  if (body.data.relayHostId !== relayHostId || userId !== sealRelayUserId(relayHostId)) {
    return status(403)
  }
  const host = env.SEAL_HOST_RELAY.get(env.SEAL_HOST_RELAY.idFromName(relayHostId))
  const { assignmentEpoch } = await host.sealAssign(userId, relayHostId, env.EDGE_CELL_ID ?? 'seal')
  // The desktop treats the lease as opaque; Seal has no director that would verify it.
  return Response.json({ v: 1, cellUrl: origin, assignmentEpoch, lease: `seal:${assignmentEpoch}` })
}

// The phone's credential is checked when it connects to the cell; resolve only reveals placement.
async function handleResolve(env: SealEnv, request: Request, origin: string): Promise<Response> {
  if (!(await admitHostAuth(env, request))) {
    return status(429)
  }
  const body = ResolveRequestSchema.safeParse(await readJson(request))
  if (!body.success) {
    return status(400)
  }
  const host = env.SEAL_HOST_RELAY.get(env.SEAL_HOST_RELAY.idFromName(body.data.relayHostId))
  const placement = await host.sealPlacement(env.EDGE_CELL_ID ?? 'seal')
  if (!placement) {
    return status(404)
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
    const body = PushDeviceRegistrationRequestSchema.safeParse(await readJson(request))
    if (!body.success) {
      return status(400)
    }
    const registered = await host.registerDevice(body.data)
    return registered ? Response.json(registered) : status(429)
  }
  const removal = /^\/v1\/devices\/([^/]{1,128})$/.exec(path)
  if (removal && request.method === 'DELETE') {
    await host.removeDevice(decodeURIComponent(removal[1]))
    return status(204)
  }
  if (path === '/v1/send' && request.method === 'POST') {
    const body = PushSendRequestSchema.safeParse(await readJson(request))
    if (!body.success) {
      return status(400)
    }
    return Response.json({ results: await host.send(hostFingerprint, body.data) })
  }
  return status(404)
}

export default {
  async fetch(request: Request, env: SealEnv): Promise<Response> {
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
      const hostFingerprint = verifyHostSession(
        env.HOST_SESSION_SECRET,
        readBearer(request.headers.get('authorization'))
      )
      if (!hostFingerprint) {
        return status(401)
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
      return edge.fetch(request, env)
    }
    return status(404)
  }
} satisfies ExportedHandler<SealEnv>
