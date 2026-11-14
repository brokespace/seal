import {
  SEAL_PROVIDERS,
  type SealAccountKey
} from '../../shared/seal-accounts/seal-accounts-config'
import { sealAccountKeysMatch } from '../../shared/seal-accounts/seal-account-key'
import {
  planFleetCredentialSync,
  type SealHostFreshness
} from '../../shared/seal-accounts/seal-credential-freshness'
import { SealAccountsImportCredentialParams } from '../../shared/rpc-contract/seal-accounts-params'
import type { SealAccountManager } from './seal-account-manager'
import { importSealCredential } from './seal-credential-transfer'
import type { SealFleetTransport } from './seal-fleet-sync'
import { exportSealCredential } from './seal-fleet-sync'
import { reconcileClaudeLogin, reconcileCodexLogin } from './seal-login-copies'
import { SEAL_DESKTOP_COPY } from './seal-fleet-copies'

export type SealFleetCredentialReport = {
  pulled: { environmentId: string; account: SealAccountKey }[]
  pushed: { environmentId: string; account: SealAccountKey }[]
  errors: string[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isFreshnessRecord(value: unknown): value is Record<string, number | null> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((entry) => entry === null || typeof entry === 'number')
  )
}

/**
 * How fresh each saved login on this host is, after bringing its local copies (account home and
 * session homes) together. Keys follow the caller's spelling, so a desktop can compare hosts.
 */
export async function localLoginFreshness(
  manager: SealAccountManager,
  keys: readonly SealAccountKey[]
): Promise<Record<SealAccountKey, number | null>> {
  const result: Record<SealAccountKey, number | null> = {}
  for (const key of keys) {
    result[key] = null
    for (const provider of SEAL_PROVIDERS) {
      const candidate = manager
        .candidates(provider)
        .find(
          (entry) => entry.kind === 'oauth' && entry.localId && sealAccountKeysMatch(entry.key, key)
        )
      if (!candidate?.localId) {
        continue
      }
      const args = { accountId: candidate.localId, accountKey: candidate.key }
      const reconciled = await (
        provider === 'claude'
          ? reconcileClaudeLogin(manager, args)
          : reconcileCodexLogin(manager, args)
      ).catch(() => null)
      result[key] = reconciled?.freshness ?? null
    }
  }
  return result
}

/**
 * Keeps every machine's copy of a login on the newest refresh token: a host that refreshed is
 * pulled into this desktop first, then the newest copy goes to every host still holding an older
 * one. Without this, the first refresh anywhere would strand every other copy.
 */
export async function reconcileFleetCredentials(
  manager: SealAccountManager,
  call: SealFleetTransport
): Promise<SealFleetCredentialReport> {
  const report: SealFleetCredentialReport = { pulled: [], pushed: [], errors: [] }
  const copies = Object.entries(manager.store.getState().fleetCopies).filter(
    ([holder, keys]) => holder !== SEAL_DESKTOP_COPY && keys.length > 0
  )
  if (copies.length === 0) {
    return report
  }
  const keys = [...new Set(copies.flatMap(([, held]) => held))]
  const vault = await localLoginFreshness(manager, keys)
  const hosts: SealHostFreshness[] = []
  for (const [environmentId, held] of copies) {
    try {
      const reply = await call(environmentId, 'seal.accounts.credentialFreshness', {
        accounts: held
      })
      const accounts =
        typeof reply === 'object' && reply !== null && 'accounts' in reply ? reply.accounts : null
      if (isFreshnessRecord(accounts)) {
        hosts.push({ environmentId, accounts })
      }
    } catch (error) {
      // An offline host catches up on a later pass.
      report.errors.push(`${environmentId}: ${errorMessage(error)}`)
    }
  }
  const plan = planFleetCredentialSync(vault, hosts)
  for (const pull of plan.pulls) {
    try {
      const credential = await call(pull.environmentId, 'seal.accounts.exportCredential', {
        account: pull.account
      })
      await importSealCredential(manager, SealAccountsImportCredentialParams.parse(credential))
      report.pulled.push(pull)
    } catch (error) {
      report.errors.push(`${pull.environmentId}: ${errorMessage(error)}`)
    }
  }
  for (const push of plan.pushes) {
    for (const account of push.accounts) {
      try {
        const credential = await exportSealCredential(manager, account)
        await call(push.environmentId, 'seal.accounts.importCredential', credential)
        report.pushed.push({ environmentId: push.environmentId, account })
      } catch (error) {
        report.errors.push(`${push.environmentId}: ${errorMessage(error)}`)
      }
    }
  }
  return report
}
