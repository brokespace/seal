import {
  SealAccountsConfigSchema,
  type SealAccountsConfig
} from '../../shared/seal-accounts/seal-accounts-config'
import { withMachineKeysRenamed } from '../../shared/seal-accounts/seal-accounts-config-edits'
import type { SealFleetHost } from './seal-fleet-host'
import type { SealAccountManager } from './seal-account-manager'
import type { SealFleetTransport } from './seal-fleet-sync'

const REPLICATE_EVERY_MS = 60_000
const EDIT_SETTLE_MS = 500

/** A machine this desktop reaches through its Seal server. */
export type SealReplicaTarget = {
  /** What the fleet transport is called with. */
  target: string
  /** The server id this desktop once named the host by (`runtime:<id>`) in machine rules. */
  environmentId: string
}

type Manager = Pick<SealAccountManager, 'getConfig' | 'saveConfig' | 'applyFleetConfig'> & {
  host: Pick<SealFleetHost, 'hostKey' | 'onConfigSaved'>
}

type Reply = { config: SealAccountsConfig | null; hostKey: string | null }

function parseReply(value: unknown): Reply {
  if (!value || typeof value !== 'object') {
    return { config: null, hostKey: null }
  }
  const config = 'config' in value ? SealAccountsConfigSchema.safeParse(value.config) : null
  const hostKey = 'hostKey' in value && typeof value.hostKey === 'string' ? value.hostKey : null
  return { config: config?.success ? config.data : null, hostKey }
}

function shareable(config: SealAccountsConfig): SealAccountsConfig {
  return { ...config, apiKeys: [] }
}

/**
 * One pass: offers this desktop's config to every Seal host, which keeps the newer of the two and
 * answers with its own. A newer answer is adopted here and carried to the hosts that missed it.
 * Rules this desktop saved under its own names for machines move to their `host:` keys.
 */
export async function replicateSealConfig(
  manager: Manager,
  targets: readonly SealReplicaTarget[],
  call: SealFleetTransport
): Promise<void> {
  const offer = async (entry: SealReplicaTarget, config: SealAccountsConfig) => {
    try {
      const reply = parseReply(
        await call(entry.target, 'seal.accounts.applyFleetConfig', { config: shareable(config) })
      )
      return { entry, ...reply }
    } catch {
      // Offline hosts catch up on a later pass.
      return null
    }
  }
  const replies = (
    await Promise.all(targets.map((entry) => offer(entry, manager.getConfig())))
  ).filter((reply) => reply !== null)
  const newest = replies.reduce<SealAccountsConfig | null>(
    (best, reply) =>
      reply.config && reply.config.updatedAt > (best?.updatedAt ?? manager.getConfig().updatedAt)
        ? reply.config
        : best,
    null
  )
  if (newest) {
    manager.applyFleetConfig(newest)
  }
  const renames = new Map<string, string>()
  if (manager.host.hostKey) {
    renames.set('local', manager.host.hostKey)
  }
  for (const reply of replies) {
    if (reply.hostKey) {
      renames.set(`runtime:${reply.entry.environmentId}`, reply.hostKey)
    }
  }
  const renamed = withMachineKeysRenamed(manager.getConfig(), renames)
  if (renamed !== manager.getConfig()) {
    // Saving dates the edit, so it reaches every host on the follow-up pass.
    manager.saveConfig(renamed)
    return
  }
  const current = manager.getConfig()
  const behind = replies.filter((reply) => (reply.config?.updatedAt ?? -1) < current.updatedAt)
  await Promise.all(behind.map((reply) => offer(reply.entry, current)))
}

/** Desktop only: keeps every Seal host's copy of the account config the same as this one's. */
export function startSealConfigReplication(
  manager: Manager,
  deps: { targets: () => SealReplicaTarget[]; call: SealFleetTransport }
): () => void {
  let running: Promise<void> | null = null
  let again = false
  let settle: ReturnType<typeof setTimeout> | null = null
  const run = (): void => {
    if (running) {
      again = true
      return
    }
    running = replicateSealConfig(manager, deps.targets(), deps.call)
      .catch((error: unknown) => {
        console.warn('[seal-accounts] Could not sync account settings with other machines:', error)
      })
      .finally(() => {
        running = null
        if (again) {
          again = false
          run()
        }
      })
  }
  const unsubscribe = manager.host.onConfigSaved(() => {
    clearTimeout(settle ?? undefined)
    settle = setTimeout(run, EDIT_SETTLE_MS)
    settle.unref?.()
  })
  const timer = setInterval(run, REPLICATE_EVERY_MS)
  timer.unref?.()
  run()
  return () => {
    unsubscribe()
    clearInterval(timer)
    clearTimeout(settle ?? undefined)
  }
}
