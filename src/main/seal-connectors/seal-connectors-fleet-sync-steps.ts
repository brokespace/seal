import * as z from 'zod'
import { sealConnectorsConfigKey } from '../../shared/seal-connectors/seal-connectors-config-merge'
import { SealConnectorsConfigSchema } from '../../shared/seal-connectors/seal-connectors-types'
import type { SealReplicaTarget } from '../seal-accounts/seal-config-replication'
import type { SealFleetTransport } from '../seal-accounts/seal-fleet-sync'
import type { SealConnectorsService } from './seal-connectors-service'

const ConfigReplySchema = z.object({
  config: SealConnectorsConfigSchema,
  hostKey: z.string().nullable()
})

/**
 * Offers this desktop's list to every host, merges each answer in here, then re-offers the
 * merged list to hosts that still differ, so every copy converges on one list.
 */
export async function replicateMergedConfig(
  service: SealConnectorsService,
  targets: readonly SealReplicaTarget[],
  call: SealFleetTransport
): Promise<void> {
  const offer = async (target: string): Promise<string | null> => {
    try {
      const reply = ConfigReplySchema.safeParse(
        await call(target, 'seal.connectors.applyConfig', { config: service.config() })
      )
      if (!reply.success) {
        return null
      }
      service.applyConfig(reply.data.config)
      return sealConnectorsConfigKey(reply.data.config)
    } catch {
      // Offline hosts catch up on a later pass.
      return null
    }
  }
  const answers = await Promise.all(
    targets.map(async (entry) => ({ entry, key: await offer(entry.target) }))
  )
  const merged = sealConnectorsConfigKey(service.config())
  await Promise.all(
    answers
      .filter((answer) => answer.key !== null && answer.key !== merged)
      .map((answer) => offer(answer.entry.target))
  )
}

// Close enough to expiry that waiting out a silent owner would leave sessions without access.
const LAPSING_MS = 10 * 60_000

export function signInsLapsing(service: SealConnectorsService, now: number): boolean {
  return service.config().connectors.some((connector) =>
    connector.signIns.some((ref) => {
      const secret = service.signIn(ref.id)
      return (
        secret?.kind === 'oauth' &&
        typeof secret.entry.expiresAt === 'number' &&
        secret.entry.expiresAt - now < LAPSING_MS
      )
    })
  )
}

/** Desktop only: keeps every Seal host's list, sign-ins and refresher lease in step with this one's. */
