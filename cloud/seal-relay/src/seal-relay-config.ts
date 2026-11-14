import { decodeCanonicalBase64 } from '../../../cloud/apps/push/src/host-auth/canonical-base64'
import { deriveHostFingerprint } from '../../../cloud/apps/push/src/host-auth/host-fingerprint'
import { edgeConfig } from '../../../cloud/apps/relay-edge/src/env'
import { HOST_ID } from '../../../cloud/apps/relay-edge/src/jwt'
import type { SealEnv } from './env'

export type SealRelayConfig = {
  /** Fingerprints of the host keys that may use this relay. Empty: nobody may. */
  enrolledHosts: ReadonlySet<string>
}

export const HOST_SESSION_SECRET_MIN_LENGTH = 32
const HOST_SESSION_SECRET_MIN_DISTINCT = 12

const configs = new WeakMap<object, SealRelayConfig>()

/** A session secret an attacker could guess lets them forge a session for any host. */
function assertHostSessionSecret(secret: unknown): void {
  if (
    typeof secret !== 'string' ||
    secret.length < HOST_SESSION_SECRET_MIN_LENGTH ||
    new Set(secret).size < HOST_SESSION_SECRET_MIN_DISTINCT
  ) {
    throw new Error('seal_relay_config_host_session_secret')
  }
}

/** Entries are host fingerprints (`seal relay host-id`) or base64 X25519 public keys. */
function parseHostAllowlist(value: unknown): ReadonlySet<string> {
  const enrolled = new Set<string>()
  if (typeof value !== 'string') {
    return enrolled
  }
  for (const entry of value.split(/[\s,]+/).filter(Boolean)) {
    const publicKey = HOST_ID.test(entry) ? null : decodeCanonicalBase64(entry, 32)
    if (!publicKey && !HOST_ID.test(entry)) {
      // A typo must not silently lock a host out or, worse, read as some other host.
      throw new Error('seal_relay_config_host_allowlist')
    }
    enrolled.add(publicKey ? deriveHostFingerprint(publicKey) : entry)
  }
  return enrolled
}

/**
 * Validated once per isolate. A deploy with a weak session secret or a malformed allowlist refuses
 * every request rather than running open; an unset allowlist enrols nobody.
 */
export function sealRelayConfig(env: SealEnv): SealRelayConfig {
  const cached = configs.get(env)
  if (cached) {
    return cached
  }
  // The edge's other backends skip credential or assignment checks Seal relies on.
  if (edgeConfig(env).backend !== 'object') {
    throw new Error('seal_relay_config_backend')
  }
  assertHostSessionSecret(env.HOST_SESSION_SECRET)
  const config = { enrolledHosts: parseHostAllowlist(env.HOST_ALLOWLIST) }
  configs.set(env, config)
  return config
}

export function hostEnrolled(env: SealEnv, hostFingerprint: string): boolean {
  return sealRelayConfig(env).enrolledHosts.has(hostFingerprint)
}
