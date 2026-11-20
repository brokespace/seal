import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebRuntimeConnectionAuth } from './web-runtime-connection-auth'
import type { PairedRuntimeConnection } from '../../../shared/remote-runtime/pairing/paired-runtime-connection'

const connection: PairedRuntimeConnection = {
  endpoint: 'ws://192.168.1.20:6768',
  hostPublicKeyB64: Buffer.alloc(32, 7).toString('base64'),
  credential: { kind: 'token', deviceToken: 'token' }
}
const plan = { kind: 'legacy-token', deviceToken: 'token' } as const

function tokenAuth(pairing = connection): WebRuntimeConnectionAuth {
  return new WebRuntimeConnectionAuth(pairing, { retryLater: () => {} })
}

beforeEach(() => {
  vi.stubGlobal('window', {
    atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value: string) => Buffer.from(value, 'binary').toString('base64')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('web sockets and E2EE v2', () => {
  it('stops on a host that refuses the hello and never sends it an older one', () => {
    const auth = tokenAuth()
    auth.createHandshake(plan)

    expect(auth.socketClosed(4001)).toMatchObject({
      code: 'unauthorized',
      reason: 'host-outdated'
    })

    const nextHello = JSON.parse(auth.createHandshake(plan).helloText())
    expect(nextHello).toMatchObject({ type: 'e2ee_hello', v: 2 })
    expect(nextHello).not.toHaveProperty('publicKeyB64')
  })

  it('leaves any other close before the ready to the reconnect loop', () => {
    const auth = tokenAuth()
    auth.createHandshake(plan)

    expect(auth.socketClosed(1006)).toBeNull()
    expect(auth.socketClosed()).toBeNull()
  })

  it('refuses a pairing whose host key is a low-order point', () => {
    expect(() =>
      tokenAuth({
        ...connection,
        hostPublicKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
      })
    ).toThrow('low-order')
  })
})
