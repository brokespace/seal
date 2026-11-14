import type { SealAccountKey } from '../../shared/seal-accounts/seal-accounts-config'
import { sealAccountKeysMatch } from '../../shared/seal-accounts/seal-account-key'
import type { SealAccountManager } from './seal-account-manager'

/** On a remote host, the holder of every login the managing desktop pushed. */
export const SEAL_DESKTOP_COPY = 'desktop'

/** Remembers which machine also holds these logins, so refreshes on either side get reconciled. */
export function recordFleetCopies(
  manager: Pick<SealAccountManager, 'store'>,
  holder: string,
  accounts: readonly SealAccountKey[]
): void {
  manager.store.updateState((next) => {
    const held = next.fleetCopies[holder] ?? []
    const added = accounts.filter((key) => !held.some((entry) => sealAccountKeysMatch(entry, key)))
    if (added.length > 0) {
      next.fleetCopies[holder] = [...held, ...added]
    }
  })
}
