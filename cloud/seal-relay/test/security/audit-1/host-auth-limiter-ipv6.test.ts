// Audit 1, A1-02: the host-auth limiter counts every IPv6 address of one /64 separately.
// Real Worker in local workerd, loopback only, keys generated here.
import { randomBytes } from 'node:crypto'
import nacl from 'tweetnacl'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { sourceKey } from '../../../../apps/relay-edge/src/preauth'
import { answerPushHostChallenge } from '../../../../../src/main/runtime/push/push-host-proof'
import {
  generateTestSecrets,
  sleep,
  startFakeProviders,
  startSealRelay
} from '../../seal-relay-harness'
import { describePoc } from './security-poc-opt-in'

let relay: Awaited<ReturnType<typeof startSealRelay>>
let providers: Awaited<ReturnType<typeof startFakeProviders>>

type Challenge = {
  challengeId: string
  gatewayEphemeralPublicKeyB64: string
  nonceB64: string
  ciphertextB64: string
  expiresAt: number
}

// The simulated limiter uses wall-clock minute windows; keep each measurement inside one window.
async function awayFromWindowEdge(): Promise<void> {
  const intoMinute = Date.now() % 60_000
  if (intoMinute > 35_000) {
    await sleep(60_000 - intoMinute + 500)
  }
}

async function requestChallenge(
  ip: string
): Promise<{ status: number; challenge: Challenge | null; keypair: nacl.BoxKeyPair }> {
  const keypair = nacl.box.keyPair()
  const response = await fetch(`${relay.origin}/v1/host/challenge`, {
    method: 'POST',
    // Stands in for the header Cloudflare's edge sets; local workerd passes it through.
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({
      v: 1,
      hostPublicKeyB64: Buffer.from(keypair.publicKey).toString('base64')
    })
  })
  const challenge = response.status === 200 ? ((await response.json()) as Challenge) : null
  if (!challenge) {
    await response.arrayBuffer()
  }
  return { status: response.status, challenge, keypair }
}

function randomPrefix(): string {
  return `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}`
}

describePoc('audit 1 A1-02: host-auth limiter key', () => {
  beforeAll(async () => {
    providers = await startFakeProviders()
    const generated = await generateTestSecrets()
    relay = await startSealRelay({
      ...generated.secrets,
      PUSH_PROVIDER_ORIGIN_OVERRIDE: providers.origin
    })
  })

  afterAll(async () => {
    await relay?.dispose()
    await providers?.close()
  })

  it('control: one IPv6 address gets 30 challenges per minute, then 429', async () => {
    await awayFromWindowEdge()
    const address = `${randomPrefix()}::1`
    const statuses: number[] = []
    for (let i = 0; i < 33; i++) {
      statuses.push((await requestChallenge(address)).status)
    }
    expect(statuses.slice(0, 30)).toEqual(Array.from({ length: 30 }, () => 200))
    expect(statuses.slice(30)).toEqual([429, 429, 429])
  })

  it('40 addresses of one /64 get 40 challenges in the same minute', async () => {
    await awayFromWindowEdge()
    const prefix = randomPrefix()
    const addresses = Array.from({ length: 40 }, (_, i) => `${prefix}::${(i + 1).toString(16)}`)
    const started = Date.now()
    const answers = []
    for (const address of addresses) {
      answers.push(await requestChallenge(address))
    }
    expect(answers.map((answer) => answer.status)).toEqual(Array.from({ length: 40 }, () => 200))

    // The 40th challenge, issued after a per-/64 budget would have run out, is redeemed for a
    // session: its row was stored.
    const last = answers.at(-1)!
    const fingerprint = last.challenge!.challengeId.split('.')[0]
    const proofB64 = answerPushHostChallenge(last.challenge!, {
      gatewayOrigin: relay.origin,
      hostFingerprint: fingerprint,
      hostPublicKey: last.keypair.publicKey,
      hostSecretKey: last.keypair.secretKey,
      onInvalid: () => {}
    })
    const session = await fetch(`${relay.origin}/v1/host/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `${prefix}::ffff` },
      body: JSON.stringify({ v: 1, challengeId: last.challenge!.challengeId, proofB64 })
    })
    expect(session.status).toBe(200)
    expect(Math.floor(started / 60_000)).toBe(Math.floor(Date.now() / 60_000))

    // The pre-auth limiter in the same Worker would have counted all 40 as one source.
    const edgeKeys = new Set(
      addresses.map((address) =>
        sourceKey(
          new Request('http://relay.invalid/', { headers: { 'cf-connecting-ip': address } })
        )
      )
    )
    expect([...edgeKeys]).toEqual([`${prefix}::/64`])
  })
})
