import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import type { RemoteRuntimeClientError } from '../remote-runtime-client-error'
import { RemoteRuntimeSubscriptionFrameRouter } from './remote-runtime-subscription-frame-router'
import { createPairedE2EEV2SessionPairForTest } from '../../../main/runtime/rpc/mobile/e2ee/paired-e2ee-v2-session-pair-test-fixture'

function createReadyRouter(callbacks: {
  onResponse: (response: unknown) => void
  onBinary?: (bytes: Uint8Array) => void
}) {
  const fail = vi.fn<(error: RemoteRuntimeClientError) => void>()
  const pair = createPairedE2EEV2SessionPairForTest()
  pair.handshake.acceptReadyText(pair.readyText)
  const router = new RemoteRuntimeSubscriptionFrameRouter<unknown>({
    handshake: pair.handshake,
    sealAuth: async () => '{}',
    isSettled: () => false,
    serializedRequest: '{}',
    requestId: 'request-1',
    send: vi.fn(),
    fail,
    onAuthenticated: vi.fn(),
    callbacks
  })
  router.state = 'ready'
  return { fail, router, host: pair.host }
}

describe('RemoteRuntimeSubscriptionFrameRouter consumer callbacks', () => {
  it('fails the subscription instead of throwing out of the socket message handler', () => {
    const { fail, router, host } = createReadyRouter({
      onResponse: () => {
        throw new Error('Unknown environment: env-1')
      }
    })
    const response = JSON.stringify({
      id: 'request-1',
      ok: true,
      result: {},
      _meta: { runtimeId: 'r' }
    })

    expect(() => router.handleFrame(Buffer.from(host.sealText(response)), false)).not.toThrow()
    expect(fail).toHaveBeenCalledOnce()
    expect(fail.mock.calls[0][0]).toMatchObject({
      code: 'runtime_error',
      message: 'Unknown environment: env-1'
    })
  })

  it('fails the subscription when a binary consumer throws', () => {
    const { fail, router, host } = createReadyRouter({
      onResponse: vi.fn(),
      onBinary: () => {
        throw new Error('consumer exploded')
      }
    })

    expect(() =>
      router.handleFrame(Buffer.from(host.sealBinary(new Uint8Array([1, 2, 3]))), true)
    ).not.toThrow()
    expect(fail).toHaveBeenCalledOnce()
    expect(fail.mock.calls[0][0]).toMatchObject({ code: 'runtime_error' })
  })
})
