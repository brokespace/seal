import nacl from 'tweetnacl'
import WebSocket from 'ws'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { E2EEKeypair } from '../../../src/main/runtime/rpc/server/pairing/e2ee-keypair'
import { sealMcpRelayIdentitySource } from '../../../src/main/seal-mcp/relay/seal-mcp-relay-startup'
import { SealMcpRelayTunnel } from '../../../src/main/seal-mcp/relay/seal-mcp-relay-tunnel'
import {
  connectSdkClientOverHttp,
  observeSealMcpConformance,
  READ_ONLY_CONFORMANCE,
  toolText
} from '../../../src/main/seal-mcp/testing/seal-mcp-sdk-client.test-support'
import {
  createSealMcpTestHost,
  type SealMcpTestHost
} from '../../../src/main/seal-mcp/testing/seal-mcp-test-host.test-support'
import { generateTestSecrets, startSealRelay, waitFor } from './seal-relay-harness'

function newHostKeypair(): E2EEKeypair {
  const box = nacl.box.keyPair()
  return { ...box, publicKeyB64: Buffer.from(box.publicKey).toString('base64') }
}

const LIST_TOOLS = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
const WELL_FORMED_UNKNOWN_TOKEN = `smcp_000000000000_${'A'.repeat(43)}`

let relay: Awaited<ReturnType<typeof startSealRelay>>
let host: SealMcpTestHost
let tunnel: SealMcpRelayTunnel
let url: string
let closers: (() => Promise<void> | void)[]

beforeAll(async () => {
  relay = await startSealRelay((await generateTestSecrets()).secrets)
})

afterAll(async () => {
  await relay?.dispose()
})

/** A Seal server with relay access switched on, dialed out to the relay under a fresh host key. */
async function hostOnline(): Promise<void> {
  const keypair = newHostKeypair()
  tunnel = new SealMcpRelayTunnel({
    relayOrigin: relay.origin,
    identity: sealMcpRelayIdentitySource({ relayOrigin: relay.origin, getKeypair: () => keypair }),
    service: host.service,
    retryMs: { min: 50, max: 200 },
    keepAliveMs: 100
  })
  closers.push(() => tunnel.stop())
  url = tunnel.publicUrl!
  host.service.updateSettings({ relayEnabled: true })
  tunnel.start()
  expect(await waitFor(() => tunnel.connected)).toBe(true)
}

beforeEach(async () => {
  host = await createSealMcpTestHost({ approvalTimeoutMs: 30_000 })
  closers = []
  await hostOnline()
})

afterEach(async () => {
  for (const close of closers.reverse()) {
    await close()
  }
  await host.dispose()
})

function relayToken(scopes: ('read' | 'sessions' | 'destructive')[] = ['read']): string {
  return host.createToken({ scopes, allowRelay: true }).token
}

function post(token: string | null, body: unknown, target = url): Promise<Response> {
  return fetch(target, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
}

describe('Seal MCP through the relay', () => {
  it('passes the official SDK client, given only an HTTPS URL and a token, through to the host', async () => {
    const client = await connectSdkClientOverHttp(url, relayToken())
    closers.push(() => client.close())

    expect(await observeSealMcpConformance(client)).toEqual(READ_ONLY_CONFORMANCE)
    expect(host.service.listAudit({ limit: 1 })[0]).toMatchObject({ transport: 'relay' })
  })

  it('asks for approval in Seal before a destructive call, and streams the result once approved', async () => {
    const client = await connectSdkClientOverHttp(url, relayToken(['sessions', 'destructive']))
    closers.push(() => client.close())
    host.service.onEvent((event) => {
      if (event.type === 'approval-requested') {
        expect(event.request.transport).toBe('relay')
        setTimeout(() => host.service.respondApproval(event.request.id, true), 100)
      }
    })

    const stopped = await client.callTool({ name: 'stop_session', arguments: { session_id: 's-local' } })

    expect(stopped.isError).toBe(false)
    expect(toolText(stopped)).toContain('Stopped s-local')
  })

  it('lets the host, not the relay, decide who gets in', async () => {
    const lanOnly = host.createToken({ scopes: ['read'] })
    const allowed = host.createToken({ scopes: ['read'], allowRelay: true })

    expect((await post(WELL_FORMED_UNKNOWN_TOKEN, LIST_TOOLS)).status).toBe(401)
    expect((await post(lanOnly.token, LIST_TOOLS)).status).toBe(401)
    expect((await post(allowed.token, LIST_TOOLS)).status).toBe(200)

    host.service.revokeClient(allowed.clientId)
    expect((await post(allowed.token, LIST_TOOLS)).status).toBe(401)
  })

  it('turns away a request that cannot be a Seal client without waking the host', async () => {
    const before = host.service.listAudit({ limit: 100 }).length

    const missing = await post(null, LIST_TOOLS)
    const malformed = await post('not-a-seal-token', LIST_TOOLS)

    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toBe('Bearer realm="seal-mcp"')
    expect(malformed.status).toBe(401)
    expect(host.service.listAudit({ limit: 100 })).toHaveLength(before)
  })

  it('answers 503 for a host that is not connected, and 404 for an id that is not a host', async () => {
    const offline = `${relay.origin}/mcp/${'ab'.repeat(8)}`

    expect((await post(relayToken(), LIST_TOOLS, offline)).status).toBe(503)
    expect((await post(relayToken(), LIST_TOOLS, `${relay.origin}/mcp/nope`)).status).toBe(404)
  })

  it('hangs up the tunnel when relay access is switched off in Settings', async () => {
    const token = relayToken()
    expect((await post(token, LIST_TOOLS)).status).toBe(200)

    host.service.updateSettings({ relayEnabled: false })

    expect(tunnel.connected).toBe(false)
    const statuses: number[] = []
    expect(
      await waitFor(() => {
        void post(token, LIST_TOOLS).then((reply) => statuses.push(reply.status))
        return statuses.includes(503)
      })
    ).toBe(true)
  })

  it('refuses a body larger than the relay will carry', async () => {
    const reply = await post(relayToken(), 'x'.repeat(600 * 1024))

    expect(reply.status).toBe(413)
  })

  it('withdraws the approval request when the remote client hangs up', async () => {
    const abort = new AbortController()
    const pending = fetch(url, {
      method: 'POST',
      signal: abort.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${relayToken(['sessions', 'destructive'])}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'stop_session', arguments: { session_id: 's-local' } }
      })
    }).catch(() => null)
    expect(await waitFor(() => host.service.listApprovals().length === 1)).toBe(true)

    abort.abort()
    await pending

    // Well inside the approval timeout: the hang-up itself withdrew it.
    expect(await waitFor(() => host.service.listApprovals().length === 0, 5_000)).toBe(true)
    expect(host.rpcCalls.filter((call) => call.method === 'liveSessions.remove')).toEqual([])
  })
})

describe('Seal MCP relay host socket', () => {
  function dialHost(authorization: string | null): Promise<number> {
    return new Promise((resolve) => {
      const socket = new WebSocket(`${relay.origin.replace(/^http/, 'ws')}/v1/host/mcp`, {
        headers: authorization ? { authorization } : {}
      })
      socket.on('unexpected-response', (_request, response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      })
      socket.on('open', () => {
        socket.terminate()
        resolve(101)
      })
      socket.on('error', () => resolve(0))
    })
  }

  it('cannot be claimed without a host session, or with a client token, or with a forged session', async () => {
    expect(await dialHost(null)).toBe(401)
    expect(await dialHost(`Bearer ${relayToken()}`)).toBe(401)
    expect(await dialHost(`Bearer ${'ab'.repeat(8)}.${Date.now() + 60_000}.${'A'.repeat(43)}`)).toBe(401)
  })

  it('cannot be used to answer for another host', async () => {
    const victimUrl = url
    const victimToken = relayToken()
    const attackerHost = await createSealMcpTestHost()
    closers.push(() => attackerHost.dispose())
    const attackerKeys = newHostKeypair()
    const attacker = new SealMcpRelayTunnel({
      relayOrigin: relay.origin,
      identity: sealMcpRelayIdentitySource({ relayOrigin: relay.origin, getKeypair: () => attackerKeys }),
      service: attackerHost.service
    })
    closers.push(() => attacker.stop())
    attackerHost.service.updateSettings({ relayEnabled: true })
    attacker.start()
    expect(await waitFor(() => attacker.connected)).toBe(true)

    expect(attacker.publicUrl).not.toBe(victimUrl)
    expect((await post(victimToken, LIST_TOOLS, victimUrl)).status).toBe(200)
    // The victim's token means nothing to the attacker's host, and never reaches it by the victim's URL.
    expect((await post(victimToken, LIST_TOOLS, attacker.publicUrl!)).status).toBe(401)
    expect(attackerHost.service.listAudit({ limit: 10 }).every((entry) => entry.transport === 'relay')).toBe(true)
    expect(host.service.listAudit({ limit: 1 })[0]).toMatchObject({ method: 'tools/list', outcome: 'ok' })
  })
})
