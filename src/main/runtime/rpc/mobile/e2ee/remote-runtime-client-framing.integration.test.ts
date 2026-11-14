import nacl from 'tweetnacl'
import { WebSocketServer, type WebSocket } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { E2EEChannel } from './e2ee-channel'
import { sendRemoteRuntimeRequestOnSocket } from '../../../../../shared/remote-runtime/requests/remote-runtime-request-socket'
import type { PairedRuntimeConnection } from '../../../../../shared/remote-runtime/pairing/paired-runtime-connection'

type TestHost = {
  connection: PairedRuntimeConnection
  /** Every first frame a client sent: one per dial. */
  hellos: Record<string, unknown>[]
  capabilities: unknown[]
  close: () => Promise<void>
}

const openHosts: TestHost[] = []

async function startHost(
  onConnection: (ws: WebSocket, host: TestHost, secretKey: Uint8Array) => void
): Promise<TestHost> {
  const keyPair = nacl.box.keyPair()
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const host: TestHost = {
    connection: {
      endpoint: `ws://127.0.0.1:${port}`,
      hostPublicKeyB64: Buffer.from(keyPair.publicKey).toString('base64'),
      credential: { kind: 'token', deviceToken: 'device-token' }
    },
    hellos: [],
    capabilities: [],
    close: () =>
      new Promise((resolve) => {
        for (const client of server.clients) {
          client.terminate()
        }
        server.close(() => resolve())
      })
  }
  server.on('connection', (ws: WebSocket) => {
    ws.once('message', (data: Buffer) => host.hellos.push(JSON.parse(data.toString())))
    onConnection(ws, host, keyPair.secretKey)
  })
  openHosts.push(host)
  return host
}

function startCurrentHost(): Promise<TestHost> {
  return startHost((ws, host, serverSecretKey) => {
    const channel = new E2EEChannel(ws, {
      serverSecretKey,
      resolveAuthenticatedDevice: (candidate) =>
        candidate === 'device-token'
          ? {
              deviceId: 'device-1',
              scope: 'runtime',
              clientId: candidate,
              callerFingerprint: 'fingerprint',
              credentialRevision: 0,
              deviceToken: candidate
            }
          : null,
      onReady: (ready) => host.capabilities.push(ready.capabilitySource.current),
      onError: (code, reason) => ws.close(code, reason)
    })
    channel.onMessage((plaintext, reply) => {
      const { id } = JSON.parse(plaintext)
      reply(JSON.stringify({ id, ok: true, result: 'pong', _meta: { runtimeId: 'r' } }))
    })
    ws.on('message', (data: Buffer) => channel.handleRawMessage(data.toString()))
  })
}

function ping(host: TestHost): Promise<unknown> {
  return sendRemoteRuntimeRequestOnSocket(
    host.connection,
    'status.ping',
    undefined,
    5_000,
    undefined,
    undefined,
    undefined,
    ['test.capability.v1'],
    undefined,
    undefined
  ).then((response) => (response.ok ? response.result : response.error))
}

afterEach(async () => {
  await Promise.all(openHosts.splice(0).map((host) => host.close()))
})

describe('remote runtime client E2EE framing', () => {
  it('authenticates a current host and carries its capabilities', async () => {
    const host = await startCurrentHost()

    await expect(ping(host)).resolves.toBe('pong')

    expect(host.capabilities[0]).toContain('test.capability.v1')
  })

  it('fails against a host that refuses the v2 hello and never offers it older framing', async () => {
    // A host from before v2 closes on a hello without a legacy public key.
    const host = await startHost((ws) => {
      ws.once('message', () => ws.close(4001, 'Invalid e2ee_hello'))
    })

    await expect(ping(host)).rejects.toMatchObject({
      code: 'remote_runtime_unavailable',
      closeCode: 4001,
      message: expect.stringContaining('Update Orca on the host')
    })
    await expect(ping(host)).rejects.toMatchObject({ closeCode: 4001 })

    expect(host.hellos).toHaveLength(2)
    for (const hello of host.hellos) {
      expect(hello).toMatchObject({ type: 'e2ee_hello', v: 2 })
      expect(hello).not.toHaveProperty('publicKeyB64')
    }
  })

  it('fails against a host whose ready carries no per-session key', async () => {
    // What a host from before forward secrecy answers: the legacy ready, or v2 without the new key.
    const host = await startHost((ws) => {
      ws.once('message', () => ws.send(JSON.stringify({ type: 'e2ee_ready' })))
    })

    await expect(ping(host)).rejects.toMatchObject({
      code: 'invalid_runtime_response',
      message: expect.stringContaining('Update Orca on the host')
    })
    expect(host.hellos).toHaveLength(1)
  })
})
