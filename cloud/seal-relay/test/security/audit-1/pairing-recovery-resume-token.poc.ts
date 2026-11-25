// Audit 1, A1-03, fixed: a pairing offer that reuses a paired host's public key could name another
// relayHostId and cell, leave a recovery journal bound to that host, and have the next recovery run
// send the host's stored relay resume token to the offer's cell. These assert that it no longer can.
// All pairing and recovery logic is the production code under mobile/src. Only the WebSocket (an
// in-memory recording socket), the unreachable direct and director dependencies and four React
// Native packages are substituted. Keys and tokens are generated here.
import { createHash, randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => {
  const asyncStore = new Map<string, string>()
  const secureStore = new Map<string, string>()
  const slot = (key: string, options?: { keychainService?: string }) =>
    `${options?.keychainService ?? ''}|${key}`
  return {
    asyncStore,
    secureStore,
    reactNative: () => ({
      Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default },
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }
    }),
    expoCrypto: async () => {
      const nodeCrypto = await import('node:crypto')
      return { getRandomBytes: (length: number) => new Uint8Array(nodeCrypto.randomBytes(length)) }
    },
    expoSecureStore: () => ({
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
      getItemAsync: async (key: string, options?: { keychainService?: string }) =>
        secureStore.get(slot(key, options)) ?? null,
      setItemAsync: async (key: string, value: string, options?: { keychainService?: string }) => {
        secureStore.set(slot(key, options), value)
      },
      deleteItemAsync: async (key: string, options?: { keychainService?: string }) => {
        secureStore.delete(slot(key, options))
      }
    }),
    asyncStorage: () => ({
      default: {
        getItem: async (key: string) => asyncStore.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          asyncStore.set(key, value)
        },
        removeItem: async (key: string) => {
          asyncStore.delete(key)
        },
        getAllKeys: async () => [...asyncStore.keys()],
        multiRemove: async (keys: string[]) => {
          for (const key of keys) {
            asyncStore.delete(key)
          }
        }
      }
    })
  }
})

// Each package is replaced under both ids the phone code's import can resolve to: the bare name
// when the phone's dependencies are not installed, the installed copy when they are.
vi.mock('react-native', fakes.reactNative)
vi.mock('../../../../../mobile/node_modules/react-native', fakes.reactNative)
vi.mock('expo-crypto', fakes.expoCrypto)
vi.mock('../../../../../mobile/node_modules/expo-crypto', fakes.expoCrypto)
vi.mock('expo-secure-store', fakes.expoSecureStore)
vi.mock('../../../../../mobile/node_modules/expo-secure-store', fakes.expoSecureStore)
vi.mock('@react-native-async-storage/async-storage', fakes.asyncStorage)
vi.mock(
  '../../../../../mobile/node_modules/@react-native-async-storage/async-storage',
  fakes.asyncStorage
)

import { parsePairingCode } from '../../../../../mobile/src/pairing/pairing'
import { loadHosts, savePairedHost } from '../../../../../mobile/src/host-catalog/host-store'
import {
  readMobileRelayCredentialBundle,
  writeMobileRelayCredentialBundle
} from '../../../../../mobile/src/host-credentials/mobile-relay-credential-bundle'
import { hashMobileRelayCredential } from '../../../../../mobile/src/transport/relay/mobile-relay-credential-hash'
import { startPreProfilePairing } from '../../../../../mobile/src/pairing/pre-profile-pairing-coordinator'
import { createMobileRelayPairingJournal } from '../../../../../mobile/src/pairing/mobile-relay-pairing-journal'
import { loadMobileRelayPairingJournal } from '../../../../../mobile/src/pairing/mobile-relay-pairing-journal-store'
import { recoverMobileRelayPairing } from '../../../../../mobile/src/pairing/mobile-relay-pairing-recovery'
import { connectMobileRelayForPairing } from '../../../../../mobile/src/pairing/mobile-relay-physical-client'

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')

type SocketRecord = { url: string; frames: string[] }
const sockets: SocketRecord[] = []

class RecordingCellSocket {
  readyState = 0
  bufferedAmount = 0
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  private readonly record: SocketRecord
  constructor(url: string) {
    this.record = { url, frames: [] }
    sockets.push(this.record)
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.()
    }, 0)
  }
  send(frame: unknown): void {
    this.record.frames.push(String(frame))
    // Behave like a cell that refuses the outer credential AFTER receiving it.
    setTimeout(
      () =>
        this.onmessage?.({ data: JSON.stringify({ type: 'relay-hello', ok: false, code: 4401 }) }),
      0
    )
  }
  close(): void {
    if (this.readyState === 3) {
      return
    }
    this.readyState = 3
    setTimeout(() => this.onclose?.({ code: 4401, reason: '' }), 0)
  }
}

const recordingTransport: typeof connectMobileRelayForPairing = (args) =>
  connectMobileRelayForPairing({
    ...args,
    createSocket: (url) => new RecordingCellSocket(url) as unknown as WebSocket
  })

const hostPublicKey = randomBytes(32)
const hostPublicKeyB64 = Buffer.from(hostPublicKey).toString('base64')
const realRelayHostId = b64url(createHash('sha256').update(hostPublicKey).digest()).slice(0, 16)
const realResumeToken = b64url(randomBytes(32))

// The offer's relay half as an attacker would write it; the public key is not secret.
function attackerRelay(relayHostId: string) {
  return {
    v: 1 as const,
    directorUrl: 'https://attacker.test',
    cellUrl: 'https://attacker.test',
    assignmentEpoch: 0,
    relayHostId,
    inviteToken: b64url(randomBytes(32)),
    inviteExpiresAt: Date.now() + 5 * 60 * 1000,
    e2eeFraming: 2 as const
  }
}

function attackerOffer(relayHostId: string) {
  return {
    v: 2 as const,
    endpoint: 'ws://203.0.113.7:6768',
    deviceToken: 'attacker-made-up-ticket',
    publicKeyB64: hostPublicKeyB64,
    relay: attackerRelay(relayHostId)
  }
}

function pairingLink(offer: unknown): string {
  return `seal://pair?code=${b64url(Buffer.from(JSON.stringify(offer)))}`
}

function framesCarryingRealToken(): string[] {
  return sockets.flatMap(({ frames }) => frames).filter((frame) => frame.includes(realResumeToken))
}

async function expectRealPairingUntouched(): Promise<void> {
  const bundle = await readMobileRelayCredentialBundle('host-legit')
  expect(bundle?.current.token).toBe(realResumeToken)
  const host = (await loadHosts()).find(({ id }) => id === 'host-legit')
  expect(host?.relay?.cellUrl).toBe('https://relay.legit.test')
  expect(host?.relay?.relayHostId).toBe(realRelayHostId)
}

describe('audit 1 A1-03: pairing recovery resume-token disclosure is closed', () => {
  beforeEach(async () => {
    sockets.length = 0
    fakes.asyncStore.clear()
    fakes.secureStore.clear()
    // Victim already relay-paired with its real host.
    await savePairedHost({
      id: 'host-legit',
      name: 'Work Mac',
      endpoint: 'ws://192.0.2.10:6768',
      deviceToken: 'legit-device-token',
      publicKeyB64: hostPublicKeyB64,
      lastConnected: Date.now(),
      relay: {
        v: 1,
        directorUrl: 'https://relay.legit.test',
        cellUrl: 'https://relay.legit.test',
        assignmentEpoch: 3,
        relayHostId: realRelayHostId,
        e2eeFraming: 2
      }
    })
    await writeMobileRelayCredentialBundle({
      v: 1,
      hostId: 'host-legit',
      deviceToken: 'legit-device-token',
      current: {
        token: realResumeToken,
        hash: hashMobileRelayCredential(realResumeToken),
        version: 1,
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
      }
    })
  })

  it('refuses the crafted offer whose relayHostId is not derived from its public key', () => {
    expect(parsePairingCode(pairingLink(attackerOffer('AAAAAAAAAAAAAAAA')))).toBeNull()
  })

  it('never sends the paired host resume token when the offer reuses its key on another relay', async () => {
    // The strongest offer the schema still takes: the real key, its real relayHostId, another relay.
    const offer = parsePairingCode(pairingLink(attackerOffer(realRelayHostId)))
    expect(offer?.relay?.cellUrl).toBe('https://attacker.test')

    // Confirm the offer; neither path authenticates, so pairing fails.
    const attempt = startPreProfilePairing({
      offer: offer!,
      timeoutMs: 5_000,
      dependencies: {
        connectDirect: (() => ({
          sendRequest: async () => {
            throw new Error('direct endpoint unreachable')
          },
          close: () => {}
        })) as never,
        connectRelay: recordingTransport,
        resolveInviteDirector: async () => {
          throw new Error('attacker director silent')
        }
      }
    })
    const pairingError = await attempt.result.then(
      () => null,
      (e: unknown) => e
    )
    attempt.dispose()
    expect(pairingError).toBeInstanceOf(Error)

    // Nothing authenticated, so the journal is not filed under the paired host.
    const journal = await loadMobileRelayPairingJournal()
    expect(journal?.metadata.relay.cellUrl).toBe('https://attacker.test')
    expect(journal?.metadata.host.id).not.toBe('host-legit')

    // Next launch runs recovery (mirrors _layout.tsx cold-start call).
    const before = sockets.length
    await recoverMobileRelayPairing({ connectRelay: recordingTransport })

    // Recovery did dial the offer's cell, with the journal's own secrets only.
    expect(
      sockets.slice(before).some(({ url }) => url.startsWith('wss://attacker.test/v1/connect/'))
    ).toBe(true)
    expect(framesCarryingRealToken()).toEqual([])
    await expectRealPairingUntouched()
  })

  it('abandons a journal an older build filed under the paired host for another relay, without dialing', async () => {
    const poisoned = createMobileRelayPairingJournal({
      offer: attackerOffer('AAAAAAAAAAAAAAAA'),
      hostId: 'host-legit',
      hostName: 'Work Mac'
    })
    const cleared: string[] = []

    const result = await recoverMobileRelayPairing({
      loadJournal: async () => poisoned,
      clearJournal: async (journalId) => {
        cleared.push(journalId)
      },
      connectRelay: recordingTransport
    })

    expect(result).toBe('abandoned')
    expect(cleared).toEqual([poisoned.metadata.journalId])
    expect(sockets).toEqual([])
    await expectRealPairingUntouched()
  })
})
