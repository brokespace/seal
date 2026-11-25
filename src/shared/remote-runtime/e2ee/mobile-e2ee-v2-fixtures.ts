import type { MobileE2EEV2Hello, MobileE2EEV2Ready } from './mobile-e2ee-v2-contract'

type MobileE2EEV2Fixture = ReturnType<typeof createMobileE2EEV2Fixture>

/** Why: the normative vector fixes both ECDH outputs, not real key pairs. */
export function mobileE2EEV2FixtureX25519(
  fixture: MobileE2EEV2Fixture
): (ourSecretKey: Uint8Array, peerPublicKey: Uint8Array) => Uint8Array {
  // The fixture's host static key is all 3s; its per-session key is all 6s.
  return (_ourSecretKey, peerPublicKey) =>
    Uint8Array.from(
      peerPublicKey[0] === 3 ? fixture.staticSharedSecret : fixture.ephemeralSharedSecret
    )
}

function repeatedByteBase64(byte: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)))
}

export function createMobileE2EEV2Fixture(): {
  hello: MobileE2EEV2Hello
  ready: MobileE2EEV2Ready
  staticSharedSecret: Uint8Array
  ephemeralSharedSecret: Uint8Array
} {
  const context = {
    protocol: 'orca-mobile-e2ee' as const,
    initiator: 'mobile' as const,
    responder: 'desktop' as const,
    transport: 'relay' as const,
    relayHostId: 'AbCdEf0123_-xyZ9'
  }
  return {
    hello: {
      type: 'e2ee_hello',
      v: 2,
      clientPublicKeyB64: repeatedByteBase64(1),
      clientNonceB64: repeatedByteBase64(2),
      capabilities: { framing: [2], payloadKinds: ['text', 'binary'], forwardSecrecy: true },
      context
    },
    ready: {
      type: 'e2ee_ready',
      v: 2,
      desktopPublicKeyB64: repeatedByteBase64(3),
      desktopEphemeralPublicKeyB64: repeatedByteBase64(6),
      clientNonceB64: repeatedByteBase64(2),
      desktopNonceB64: repeatedByteBase64(4),
      selection: { framing: 2, payloadKinds: ['text', 'binary'], forwardSecrecy: true },
      context
    },
    staticSharedSecret: new Uint8Array(32).fill(5),
    ephemeralSharedSecret: new Uint8Array(32).fill(7)
  }
}

// Computed outside this codebase (Python hashlib/hmac) from the fixture above.
export const MOBILE_E2EE_V2_VECTOR = {
  transcriptLength: 1546,
  transcriptHashHex: '883685c4e5f63f3c597dbae27ea958226c7b8cd1b6ec5f93b2dc62624f1c0c76',
  mobileToDesktopKeyHex: '689badfbb09495c5a245ae8bebbe962933c405e2b3f14c7eaf2757ab74027526',
  desktopToMobileKeyHex: 'b57d3d59e96b240d2b13e2822f2a90608dd1e3f85ecde9907fc5187032e7ad69',
  sessionIdHex: 'e236c375221ccc5b43e7cdee675dda8a3df7d39c384aed93ac15bac244b79d83'
} as const
