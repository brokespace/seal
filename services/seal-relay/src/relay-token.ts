import { importJWK, SignJWT } from 'jose'
import { z } from 'zod'
import type { SealEnv } from './env'

export const RELAY_TOKEN_TTL_MS = 60 * 60 * 1000

const PrivateJwkSchema = z.looseObject({
  kty: z.literal('EC'),
  d: z.string(),
  kid: z.string().optional()
})

let cachedSigner: { source: string; key: CryptoKey; kid: string | undefined } | null = null

async function signer(env: SealEnv): Promise<{ key: CryptoKey; kid: string | undefined }> {
  if (cachedSigner?.source !== env.RELAY_JWT_PRIVATE_JWK) {
    const jwk = PrivateJwkSchema.parse(JSON.parse(env.RELAY_JWT_PRIVATE_JWK))
    const key = await importJWK(jwk, 'ES256')
    if (key instanceof Uint8Array) {
      throw new Error('RELAY_JWT_PRIVATE_JWK must be an EC key')
    }
    cachedSigner = { source: env.RELAY_JWT_PRIVATE_JWK, key, kid: jwk.kid }
  }
  return cachedSigner
}

// A Seal host is its own account: the relay user, profile and host id all derive from its key.
export function sealRelayUserId(relayHostId: string): string {
  return `seal:${relayHostId}`
}

export async function mintRelayToken(
  env: SealEnv,
  relayHostId: string,
  now = Date.now()
): Promise<{ relayToken: string; expiresAt: number }> {
  const { key, kid } = await signer(env)
  const expiresAt = now + RELAY_TOKEN_TTL_MS
  const userId = sealRelayUserId(relayHostId)
  const relayToken = await new SignJWT({ prof: userId, relayHostId, purpose: 'host-control' })
    .setProtectedHeader({ alg: 'ES256', ...(kid ? { kid } : {}) })
    .setSubject(userId)
    .setAudience(env.RELAY_JWT_AUDIENCE)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .sign(key)
  return { relayToken, expiresAt }
}
