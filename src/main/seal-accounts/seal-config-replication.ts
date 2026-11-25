import {
  SealAccountsConfigSchema,
  type SealAccountsConfig
} from '../../shared/seal-accounts/seal-accounts-config'
import { withMachineKeysRenamed } from '../../shared/seal-accounts/seal-accounts-config-edits'
import type { SealFleetHost } from './seal-fleet-host'
import type { SealAccountManager } from './seal-account-manager'
import type { SealFleetTransport } from './seal-fleet-sync'
import { replicateNewestWins, startReplicationLoop } from './newest-wins-replication'

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
  await replicateNewestWins({
    targets,
    local: () => manager.getConfig(),
    adopt: (config) => manager.applyFleetConfig(config),
    offer: async (entry, config) =>
      parseReply(
        await call(entry.target, 'seal.accounts.applyFleetConfig', { config: shareable(config) })
      ),
    afterAdopt: (replies) => {
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
      if (renamed === manager.getConfig()) {
        return false
      }
      // Saving dates the edit, so it reaches every host on the follow-up pass.
      manager.saveConfig(renamed)
      return true
    }
  })
}

/** Desktop only: keeps every Seal host's copy of the account config the same as this one's. */
export function startSealConfigReplication(
  manager: Manager,
  deps: {
    targets: () => SealReplicaTarget[]
    call: SealFleetTransport
    /** Fires as each Seal server comes online, which is when it may hold edits made there. */
    onHostOnline: (listener: () => void) => () => void
  }
): () => void {
  return startReplicationLoop({
    run: () => replicateSealConfig(manager, deps.targets(), deps.call),
    onEdit: (listener) => manager.host.onConfigSaved(listener),
    onHostOnline: deps.onHostOnline,
    failureMessage: '[seal-accounts] Could not sync account settings with other machines:'
  }).stop
}
