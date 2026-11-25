import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { RelayControlClient } from '../../../../src/main/runtime/mobile-cloud-relay/control-channel/relay-control-client'
import {
  createSealRelayContextReader,
  sealRelayEndpointConfig,
  sealRelayIdentity
} from '../../../../src/main/runtime/mobile-cloud-relay/authentication/seal-relay-host-auth'
import {
  deriveRelayHostId,
  exchangeRelayAuthorization,
  requestRelayAssignment
} from '../../../../src/main/runtime/mobile-cloud-relay/director/relay-http-client'
import { RelayAssignRateGate } from '../../../../src/main/runtime/mobile-cloud-relay/director/relay-assign-rate-gate'
import { CloudRelayTransport } from '../../../../src/main/runtime/rpc/transports/relay-transport'
import {
  generateTestSecrets,
  sleep,
  startFakeProviders,
  startSealRelay,
  type HostKeypair
} from '../seal-relay-harness'

export { newHostKeypair, type HostKeypair } from '../seal-relay-harness'

export type RelayUnderTest = {
  origin: string
  providers: Awaited<ReturnType<typeof startFakeProviders>>
  /** The generated secrets, so a test can restart the relay as the same deploy. */
  secrets: Record<string, string>
  dispose: () => Promise<void>
}

export async function startRelayUnderTest(
  options: {
    enrolled?: readonly HostKeypair[]
    vars?: Record<string, string>
    secrets?: Record<string, string>
    persist?: string
  } = {}
): Promise<RelayUnderTest> {
  const providers = await startFakeProviders()
  const secrets = options.secrets ?? (await generateTestSecrets()).secrets
  const relay = await startSealRelay(
    { ...secrets, ...options.vars },
    {
      enrolled: options.enrolled,
      providerOrigin: providers.origin,
      ...(options.persist ? { persist: options.persist } : {})
    }
  )
  return {
    origin: relay.origin,
    providers,
    secrets,
    dispose: async () => {
      await relay.dispose()
      await providers.close()
    }
  }
}

/** The local limiter counts in wall-clock minutes; a measurement must not straddle two of them. */
export async function awayFromLimiterWindowEdge(): Promise<void> {
  const intoMinute = Date.now() % 60_000
  if (intoMinute > 40_000) {
    await sleep(60_000 - intoMinute + 500)
  }
}

/** A host session as the Worker signs one, for a caller who holds its HOST_SESSION_SECRET. */
export function signHostSession(
  secret: string,
  hostFingerprint: string,
  expiresAt = Date.now() + 60 * 60 * 1000
): string {
  const signature = createHmac('sha256', secret)
    .update(`seal-host-session/v1\0${hostFingerprint}\0${expiresAt}`)
    .digest('base64url')
  return `${hostFingerprint}.${expiresAt}.${signature}`
}

/** The host session a key holder gets from the public challenge endpoints. */
export async function hostSessionToken(origin: string, keypair: HostKeypair): Promise<string> {
  const context = await createSealRelayContextReader({ relayOrigin: origin, keypair })()
  return context!.accessToken
}

export async function relayTokenFor(
  origin: string,
  sessionToken: string,
  keypair: HostKeypair
): Promise<string> {
  const { relayToken } = await exchangeRelayAuthorization({
    endpoint: sealRelayEndpointConfig(origin).relayTokenEndpoint,
    accessToken: sessionToken,
    keypair
  })
  return relayToken
}

export function controlClient(input: {
  cellUrl: string
  relayToken: string
  relayHostId: string
  assignmentEpoch: number
  keypair: HostKeypair
  onConnectionOpen?: (open: { connId: string }) => void
}): RelayControlClient {
  return new RelayControlClient({
    cellUrl: input.cellUrl,
    relayJwt: input.relayToken,
    relayHostId: input.relayHostId,
    assignmentEpoch: input.assignmentEpoch,
    identity: sealRelayIdentity(input.relayHostId),
    keypair: input.keypair,
    appVersion: 'seal-security-poc',
    onConnectionOpen: input.onConnectionOpen ?? (() => {}),
    onDrain: () => {},
    onClose: () => {},
    createSocket: (url, token) =>
      new WebSocket(url, { headers: { authorization: `Bearer ${token}` }, perMessageDeflate: false })
  })
}

/** Everything a desktop does to become a live relay host, using only its own key. */
export async function enrolHost(origin: string, keypair: HostKeypair) {
  const relayHostId = deriveRelayHostId(keypair.publicKey)
  const sessionToken = await hostSessionToken(origin, keypair)
  const relayToken = await relayTokenFor(origin, sessionToken, keypair)
  const assignment = await requestRelayAssignment({
    directorUrl: origin,
    relayToken,
    relayHostId,
    assignRateGate: new RelayAssignRateGate()
  })
  const opens: { connId: string }[] = []
  let transport: CloudRelayTransport | null = null
  const client = controlClient({
    cellUrl: assignment.cellUrl,
    relayToken,
    relayHostId,
    assignmentEpoch: assignment.assignmentEpoch,
    keypair,
    onConnectionOpen: (open) => {
      opens.push(open)
      void transport?.openConnection(open as Parameters<CloudRelayTransport['openConnection']>[0])
    }
  })
  const ack = await client.connect()
  transport = new CloudRelayTransport({
    cellUrl: assignment.cellUrl,
    relayHostId,
    generation: ack.generation
  })
  const liveTransport = transport
  const stop = async (): Promise<void> => {
    client.closeNow()
    await liveTransport.stop()
  }
  return {
    client,
    transport: liveTransport,
    ack,
    opens,
    relayHostId,
    sessionToken,
    relayToken,
    assignment,
    stop
  }
}

export type PhoneSocket = {
  socket: WebSocket
  /** The relay's first text frame, once it arrives. */
  hello: () => Record<string, unknown> | null
  closeCode: () => number | null
  /** Resolves when the relay answers the credential or closes the socket. */
  settled: Promise<void>
  closed: Promise<number>
}

/** Dial the phone endpoint and send `frames` as soon as it opens. */
export function openPhone(
  origin: string,
  relayHostId: string,
  frames: readonly string[],
  headers: Record<string, string> = {}
): PhoneSocket {
  const socket = new WebSocket(`${origin.replace(/^http/, 'ws')}/v1/connect/${relayHostId}`, {
    perMessageDeflate: false,
    headers
  })
  let hello: Record<string, unknown> | null = null
  let closeCode: number | null = null
  let settle = (): void => {}
  let close = (_code: number): void => {}
  const settled = new Promise<void>((resolve) => {
    settle = resolve
  })
  const closed = new Promise<number>((resolve) => {
    close = resolve
  })
  const finish = (code: number): void => {
    closeCode ??= code
    settle()
    close(closeCode)
  }
  socket.on('open', () => {
    for (const frame of frames) {
      socket.send(frame)
    }
  })
  socket.on('message', (raw: Buffer, isBinary: boolean) => {
    if (!isBinary && hello === null) {
      hello = JSON.parse(raw.toString())
      settle()
    }
  })
  socket.on('close', finish)
  socket.on('error', () => finish(0))
  socket.on('unexpected-response', (_request, response) => {
    response.resume()
    finish(response.statusCode ?? 0)
  })
  return { socket, hello: () => hello, closeCode: () => closeCode, settled, closed }
}

export function relayAuthFrame(credential: string): string {
  return JSON.stringify({ type: 'relay-auth', v: 1, mode: 'connect', credential })
}

export type PhoneAttempt = { hello: Record<string, unknown> | null; closeCode: number | null }

/** Dial the phone endpoint with a credential and report the relay's verdict. */
export async function phoneConnect(
  origin: string,
  relayHostId: string,
  credential: string,
  timeoutMs = 5000
): Promise<PhoneAttempt> {
  const phone = openPhone(origin, relayHostId, [relayAuthFrame(credential)])
  await Promise.race([
    phone.settled.then(() => (phone.hello()?.ok === true ? undefined : phone.closed)),
    sleep(timeoutMs)
  ])
  phone.socket.terminate()
  return { hello: phone.hello(), closeCode: phone.closeCode() }
}

type LiveHost = Awaited<ReturnType<typeof enrolHost>>

/** Pairs a phone by invite and installs its resume credential, leaving the phone connected. */
export async function pairPhone(
  origin: string,
  host: LiveHost,
  relayDeviceId: string
): Promise<{ resumeToken: string; phone: PhoneSocket }> {
  const invite = await host.client.createInvite(relayDeviceId)
  const phone = openPhone(origin, host.relayHostId, [relayAuthFrame(invite.inviteToken)])
  await phone.settled
  if (phone.hello()?.ok !== true) {
    throw new Error(`invite refused: ${JSON.stringify(phone.hello())} ${phone.closeCode()}`)
  }
  const resumeToken = randomBytes(32).toString('base64url')
  await host.client.installCredential({
    reqId: randomUUID(),
    relayDeviceId,
    newResumeTokenHash: createHash('sha256').update(resumeToken).digest('base64url'),
    authorization: { mode: 'relay-basis', basisConnId: host.opens.at(-1)!.connId }
  })
  return { resumeToken, phone }
}

export function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
}
