import { loadHostCatalog } from '../../host-catalog/host-store'
import { resolveHostIdForFingerprint } from './push-host-fingerprint'

/** Null for a push from a host this phone is not paired with, or when the catalog cannot be read. */
export async function resolvePairedPushHostId(payload: {
  readonly hostFingerprint: string
}): Promise<string | null> {
  const hosts = await loadHostCatalog().catch(() => [])
  return resolveHostIdForFingerprint(payload.hostFingerprint, hosts)
}
