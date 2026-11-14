import type { SealAccountKey, SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import { oauthAccountKey, sealAccountKeysMatch } from '../../shared/seal-accounts/seal-account-key'
import type { SealSystemLogin } from '../../shared/seal-accounts/seal-accounts-status'
import type { SealAccountManager } from './seal-account-manager'
import { readSealSystemLogins } from './seal-system-login'

type Listing = Pick<SealAccountManager, 'services' | 'store' | 'baseCandidates'>

/** The machine's own CLI logins, and whether Seal lists each or the user removed it. */
export function sealSystemLoginStatus(
  manager: Listing
): Record<SealProvider, SealSystemLogin | null> {
  const logins = readSealSystemLogins(manager.services)
  const dismissed = manager.store.getState().dismissedSystemLogins
  const describe = (provider: SealProvider): SealSystemLogin | null => {
    const login = logins[provider]
    if (!login) {
      return null
    }
    const key = oauthAccountKey(provider, login.email, login.scope)
    const listed = manager
      .baseCandidates(provider)
      .some((entry) => sealAccountKeysMatch(entry.key, key))
    return {
      key,
      email: login.email,
      orgName: login.orgName,
      state:
        !listed && dismissed.some((entry) => sealAccountKeysMatch(entry, key))
          ? 'dismissed'
          : 'listed'
    }
  }
  return { claude: describe('claude'), codex: describe('codex') }
}

/** Lists the machine's own login again after the user removed it from Seal. */
export function restoreSealSystemLogin(manager: Listing, provider: SealProvider): SealSystemLogin {
  const login = sealSystemLoginStatus(manager)[provider]
  if (!login) {
    const cli = provider === 'claude' ? 'claude' : 'codex'
    throw new Error(
      `This machine's ${cli} CLI is not signed in. Sign in with \`${cli}\` first, or add the account here.`
    )
  }
  manager.store.updateState((next) => {
    next.dismissedSystemLogins = next.dismissedSystemLogins.filter(
      (entry) => !sealAccountKeysMatch(entry, login.key)
    )
  })
  return { ...login, state: 'listed' }
}

/** Keeps a removed system login out of the list across scans and restarts. */
export function dismissSealSystemLogin(manager: Listing, key: SealAccountKey): void {
  manager.store.updateState((next) => {
    if (!next.dismissedSystemLogins.some((entry) => sealAccountKeysMatch(entry, key))) {
      next.dismissedSystemLogins.push(key)
    }
  })
}

export function dismissSealMigrationNotice(manager: Pick<SealAccountManager, 'store'>): void {
  manager.store.updateState((next) => {
    if (next.accountsMigration) {
      next.accountsMigration.notice = null
    }
  })
}
