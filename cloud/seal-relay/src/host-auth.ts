import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import nacl from 'tweetnacl'
import {
  buildPushHostChallengePlaintext,
  buildPushHostProofMacInput,
  buildPushHostProofTranscript
} from '../../../cloud/packages/push-contract/src/push-host-proof-transcript'
import { PUSH_LIMITS } from '../../../cloud/packages/push-contract/src/push-limits'
import type { PushHostChallengeResponse } from '../../../cloud/packages/push-contract/src/host-auth-messages'
import { decodeCanonicalBase64 } from '../../../cloud/apps/push/src/host-auth/canonical-base64'
import { deriveHostFingerprint } from '../../../cloud/apps/push/src/host-auth/host-fingerprint'

// A host proves it holds the X25519 key behind its fingerprint with the push gateway's
// challenge (the desktop's PushGatewaySession speaks it), then carries a stateless session token.

export type PendingChallenge = { proofHash: string; expiresAt: number }

export type IssuedChallenge = {
  hostFingerprint: string
  pending: PendingChallenge
  response: PushHostChallengeResponse
}

export function sha256B64url(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('base64url')
}

export function equalStrings(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function issueHostChallenge(
  gatewayOrigin: string,
  hostPublicKeyB64: string,
  now = Date.now()
): IssuedChallenge | null {
  const hostPublicKey = decodeCanonicalBase64(hostPublicKeyB64, 32)
  if (!hostPublicKey) {
    return null
  }
  const hostFingerprint = deriveHostFingerprint(hostPublicKey)
  const ephemeral = nacl.box.keyPair()
  const challengeNonce = randomBytes(nacl.box.nonceLength)
  const challengeSecret = randomBytes(32)
  // The fingerprint prefix routes the answer to the object holding this challenge.
  const challengeId = `${hostFingerprint}.${randomUUID()}`
  const expiresAt = now + PUSH_LIMITS.challengeTtlMs
  const transcript = buildPushHostProofTranscript({
    gatewayOrigin,
    gatewayEphemeralPublicKey: ephemeral.publicKey,
    challengeNonce,
    challengeId,
    issuedAt: now,
    expiresAt,
    hostFingerprint,
    hostPublicKey
  })
  const ciphertext = nacl.box(
    buildPushHostChallengePlaintext(transcript, challengeSecret),
    challengeNonce,
    hostPublicKey,
    ephemeral.secretKey
  )
  const expectedProof = createHmac('sha256', challengeSecret)
    .update(buildPushHostProofMacInput(transcript))
    .digest()
  return {
    hostFingerprint,
    pending: { proofHash: sha256B64url(expectedProof), expiresAt },
    response: {
      challengeId,
      gatewayEphemeralPublicKeyB64: Buffer.from(ephemeral.publicKey).toString('base64'),
      nonceB64: Buffer.from(challengeNonce).toString('base64'),
      ciphertextB64: Buffer.from(ciphertext).toString('base64'),
      expiresAt
    }
  }
}

export function challengeFingerprint(challengeId: string): string | null {
  const match = /^([A-Za-z0-9_-]{16})\.[0-9a-f-]{36}$/.exec(challengeId)
  return match ? match[1] : null
}

export function proofHash(proofB64: string): string | null {
  const proof = decodeCanonicalBase64(proofB64, 32)
  return proof ? sha256B64url(proof) : null
}

function sessionSignature(secret: string, hostFingerprint: string, expiresAt: number): string {
  return createHmac('sha256', secret)
    .update(`seal-host-session/v1\0${hostFingerprint}\0${expiresAt}`)
    .digest('base64url')
}

export function mintHostSession(
  secret: string,
  hostFingerprint: string,
  now = Date.now()
): { sessionToken: string; expiresAt: number; hostFingerprint: string } {
  const expiresAt = now + PUSH_LIMITS.sessionTtlMs
  const sessionToken = `${hostFingerprint}.${expiresAt}.${sessionSignature(secret, hostFingerprint, expiresAt)}`
  return { sessionToken, expiresAt, hostFingerprint }
}

export function verifyHostSession(
  secret: string,
  token: string | null,
  now = Date.now()
): string | null {
  const match = token ? /^([A-Za-z0-9_-]{16})\.(\d{13,16})\.([A-Za-z0-9_-]{43})$/.exec(token) : null
  if (!match) {
    return null
  }
  const [, hostFingerprint, expiresRaw, signature] = match
  const expiresAt = Number(expiresRaw)
  if (expiresAt <= now) {
    return null
  }
  return equalStrings(signature, sessionSignature(secret, hostFingerprint, expiresAt))
    ? hostFingerprint
    : null
}

export function fingerprintOfPublicKey(hostPublicKeyB64: string): string | null {
  const key = decodeCanonicalBase64(hostPublicKeyB64, 32)
  return key ? deriveHostFingerprint(key) : null
}
