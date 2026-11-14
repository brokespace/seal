import nacl from 'tweetnacl'
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
import type { E2EEKeypair } from '../../../../src/main/runtime/rpc/server/pairing/e2ee-keypair'
import { CloudRelayTransport } from '../../../../src/main/runtime/rpc/transports/relay-transport'
import { generateTestSecrets, startFakeProviders, startSealRelay } from '../seal-relay-harness'

export type HostKeypair = E2EEKeypair

export function newHostKeypair(): HostKeypair {
  const box = nacl.box.keyPair()
  return { ...box, publicKeyB64: Buffer.from(box.publicKey).toString('base64') }
}

export type RelayUnderTest = {
  origin: string
  providers: Awaited<ReturnType<typeof startFakeProviders>>
  dispose: () => Promise<void>
}

export async function startRelayUnderTest(
  overrides: Record<string, string> = {}
): Promise<RelayUnderTest> {
  const providers = await startFakeProviders()
  const { secrets } = await generateTestSecrets()
  const relay = await startSealRelay({
    ...secrets,
    PUSH_PROVIDER_ORIGIN_OVERRIDE: providers.origin,
    ...overrides
  })
  return {
    origin: relay.origin,
    providers,
    dispose: async () => {
      await relay.dispose()
      await providers.close()
    }
  }
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

export type PhoneAttempt = { hello: Record<string, unknown> | null; closeCode: number | null }

/** Dial the phone endpoint with a credential and report the relay's verdict. */
export function phoneConnect(
  origin: string,
  relayHostId: string,
  credential: string,
  timeoutMs = 5000
): Promise<PhoneAttempt> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${origin.replace(/^http/, 'ws')}/v1/connect/${relayHostId}`, {
      perMessageDeflate: false
    })
    const outcome: PhoneAttempt = { hello: null, closeCode: null }
    const finish = (): void => {
      clearTimeout(timer)
      socket.terminate()
      resolve(outcome)
    }
    const timer = setTimeout(finish, timeoutMs)
    socket.on('open', () =>
      socket.send(JSON.stringify({ type: 'relay-auth', v: 1, mode: 'connect', credential }))
    )
    socket.on('message', (raw: Buffer, isBinary: boolean) => {
      if (!isBinary && outcome.hello === null) {
        outcome.hello = JSON.parse(raw.toString())
        if (outcome.hello?.ok === true) {
          finish()
        }
      }
    })
    socket.on('close', (code) => {
      outcome.closeCode = code
      finish()
    })
    socket.on('error', finish)
    socket.on('unexpected-response', (_request, response) => {
      outcome.closeCode = response.statusCode ?? null
      finish()
    })
  })
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
