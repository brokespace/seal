import { describe, expect, it, vi } from 'vitest'
import type { E2EEKeypair } from '../../runtime/rpc/server/pairing/e2ee-keypair'
import type { SealMcpService } from '../seal-mcp-service'
import type { SealMcpRelayTunnelOptions } from './seal-mcp-relay-tunnel'

const tunnels = vi.hoisted(() => [] as SealMcpRelayTunnelOptions[])

vi.mock('./seal-mcp-relay-tunnel', () => ({
  SealMcpRelayTunnel: class {
    constructor(options: SealMcpRelayTunnelOptions) {
      tunnels.push(options)
    }
    get publicUrl(): string | null {
      return null
    }
    get connected(): boolean {
      return false
    }
    start(): void {}
    stop(): void {}
  }
}))

vi.mock('../seal-mcp-service-instance', () => ({
  whenSealMcpServiceRuns: (listener: (service: SealMcpService) => void) => {
    listener({ setEndpoints: () => {}, statusChanged: () => {} } as unknown as SealMcpService)
    return () => {}
  }
}))

const { startSealMcpEndpoints } = await import('./seal-mcp-relay-startup')

/** Like the runtime RPC server: the keypair lives on the instance, so its getter needs `this`. */
class FakeRuntimeRpc {
  private readonly keypair: E2EEKeypair = {
    publicKey: new Uint8Array(32).fill(7),
    secretKey: new Uint8Array(32).fill(9),
    publicKeyB64: Buffer.from(new Uint8Array(32).fill(7)).toString('base64')
  }

  getE2EEKeypair(): E2EEKeypair | null {
    return this.keypair
  }

  getWebSocketEndpoint(): string | null {
    return null
  }
}

describe('startSealMcpEndpoints', () => {
  it('reads the pairing key from the runtime RPC instance, so the server has a relay identity', () => {
    const stop = startSealMcpEndpoints({
      runtimeRpc: new FakeRuntimeRpc(),
      relayOrigin: 'https://relay.seal.example'
    })
    const identity = tunnels.at(-1)?.identity()
    expect(identity?.hostId).toMatch(/^[A-Za-z0-9_-]{16}$/)
    stop()
  })
})
