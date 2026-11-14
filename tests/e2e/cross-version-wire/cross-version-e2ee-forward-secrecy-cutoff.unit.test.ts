import nacl from 'tweetnacl'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { E2EEChannel as CurrentChannel } from '../../../src/main/runtime/rpc/mobile/e2ee/e2ee-channel'
import { createPairedE2EEClientHandshake } from '../../../src/shared/remote-runtime/e2ee/paired-e2ee-client-handshake'
import { NODE_PAIRED_E2EE_PRIMITIVES } from '../../../src/shared/remote-runtime/e2ee/node/paired-e2ee-node-primitives'
import { PRE_FORWARD_SECRECY_RELEASE_REF } from './pre-forward-secrecy-release'
import { importReleaseCheckoutModule, materializeReleaseCheckout } from './release-checkout'

// Released peers must be cut off in both directions: no session, and never a hello in their framing.
const SUITE_TIMEOUT_MS = 180_000

type ChannelLike = { handleRawMessage(raw: string): void; destroy(): void }
type ChannelConstructor = new (ws: unknown, options: Record<string, unknown>) => ChannelLike
type ReleasedHandshakeFactory = (args: {
  primitives: unknown
  hostPublicKeyB64: string
  framing: 'legacy' | 'v2'
  transport: 'direct'
}) => { helloText(): string }

const CurrentChannelConstructor =
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the current E2EEChannel accepts the fake socket and the options below.
  CurrentChannel as unknown as ChannelConstructor
const host = nacl.box.keyPair()
const hostPublicKeyB64 = Buffer.from(host.publicKey).toString('base64')
let ReleasedChannel: ChannelConstructor
let createReleasedHandshake: ReleasedHandshakeFactory
let releasedPrimitives: unknown

beforeAll(async () => {
  const checkout = await materializeReleaseCheckout(PRE_FORWARD_SECRECY_RELEASE_REF)
  const [channelModule, handshakeModule, primitivesModule] = await Promise.all([
    importReleaseCheckoutModule(checkout, 'src/main/runtime/rpc/e2ee-channel.ts'),
    importReleaseCheckoutModule(
      checkout,
      'src/shared/remote-runtime/e2ee/paired-e2ee-client-handshake.ts'
    ),
    importReleaseCheckoutModule(
      checkout,
      'src/shared/remote-runtime/e2ee/node/paired-e2ee-node-primitives.ts'
    )
  ])
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the pinned release's E2EEChannel class; a changed shape fails the assertions below.
  ReleasedChannel = channelModule.E2EEChannel as ChannelConstructor
  createReleasedHandshake =
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the pinned release's client handshake; only its hello is read.
    handshakeModule.createPairedE2EEClientHandshake as ReleasedHandshakeFactory
  releasedPrimitives = primitivesModule.NODE_PAIRED_E2EE_PRIMITIVES
}, SUITE_TIMEOUT_MS)

function hostChannel(Channel: ChannelConstructor) {
  const sent: unknown[] = []
  const onReady = vi.fn()
  const onError = vi.fn()
  const channel = new Channel(
    { OPEN: 1, readyState: 1, bufferedAmount: 0, send: (data: unknown) => sent.push(data) },
    {
      serverSecretKey: host.secretKey,
      resolveAuthenticatedDevice: () => null,
      onReady,
      onError
    }
  )
  return { channel, sent, onReady, onError }
}

describe('cross-version: peers without forward-secret E2EE are refused', () => {
  it.each([
    { framing: 'legacy', closeReason: 'E2EE v2 required' },
    { framing: 'v2', closeReason: 'Invalid e2ee_hello v2' }
  ] as const)(
    'this host closes a released client $framing hello without answering it',
    ({ framing, closeReason }) => {
      const { channel, sent, onReady, onError } = hostChannel(CurrentChannelConstructor)
      const released = createReleasedHandshake({
        primitives: releasedPrimitives,
        hostPublicKeyB64,
        framing,
        transport: 'direct'
      })

      channel.handleRawMessage(released.helloText())

      expect(sent).toEqual([])
      expect(onError).toHaveBeenCalledWith(4001, closeReason)
      expect(onReady).not.toHaveBeenCalled()
      channel.destroy()
    }
  )

  it('a released host refuses this client hello, which leaves the client unkeyed', () => {
    const { channel, sent, onReady, onError } = hostChannel(ReleasedChannel)
    const handshake = createPairedE2EEClientHandshake({
      primitives: NODE_PAIRED_E2EE_PRIMITIVES,
      hostPublicKeyB64,
      transport: 'direct',
      v2TokenCapabilities: true
    })

    channel.handleRawMessage(handshake.helloText())

    expect(sent).toEqual([])
    expect(onError).toHaveBeenCalledWith(4001, 'Invalid e2ee_hello v2')
    expect(onReady).not.toHaveBeenCalled()
    expect(handshake.transcriptHashB64()).toBeNull()
    channel.destroy()
  })
})
