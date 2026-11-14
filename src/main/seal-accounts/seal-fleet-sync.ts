import { SEAL_PROVIDERS } from '../../shared/seal-accounts/seal-accounts-config'
import { findCandidateByRef } from '../../shared/seal-accounts/seal-launch-account-pick'
import type { SealAccountsImportCredential } from '../../shared/rpc-contract/seal-accounts-params'
import type { SealAccountManager } from './seal-account-manager'
import { exportClaudeCredential, exportCodexCredential } from './seal-credential-transfer'
import { reconcileClaudeLogin, reconcileCodexLogin } from './seal-login-copies'
import { recordFleetCopies } from './seal-fleet-copies'

/** Desktop main sets this to reach other machines; orcad leaves it unset. */
export type SealFleetTransport = (
  target: string,
  method: string,
  params: unknown
) => Promise<unknown>

export type SealFleetSyncResult = {
  /** The machine (or server) id the push went to. */
  environmentId: string
  ok: boolean
  error: string | null
  /** False on machines without a resident Seal: logins land, but nothing there swaps on its own. */
  policyApplied: boolean
  credentials: { account: string; ok: boolean; error: string | null }[]
}

let transport: SealFleetTransport | null = null

export function setSealFleetTransport(next: SealFleetTransport | null): void {
  transport = next
}

export function sealFleetTransport(): SealFleetTransport | null {
  return transport
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function exportSealCredential(
  manager: SealAccountManager,
  ref: string
): Promise<SealAccountsImportCredential> {
  for (const provider of SEAL_PROVIDERS) {
    const candidate = findCandidateByRef(manager.candidates(provider), ref)
    if (!candidate) {
      continue
    }
    if (candidate.kind === 'api-key') {
      throw new Error('API keys stay in the keychain of the machine they were added on.')
    }
    if (candidate.localId) {
      // Hand out the newest copy (refreshed if near expiry), never one a session already rotated.
      const args = { accountId: candidate.localId, accountKey: candidate.key }
      await (
        provider === 'claude'
          ? reconcileClaudeLogin(manager, args)
          : reconcileCodexLogin(manager, args)
      ).catch(() => {})
    }
    return provider === 'claude'
      ? exportClaudeCredential(manager.services, candidate)
      : exportCodexCredential(candidate, (id) => manager.codexHome(id))
  }
  throw new Error(`No account matches "${ref}".`)
}

/**
 * Pushes this desktop's policy, and any logins asked for, to other machines. Seal servers then swap
 * on their own. Refresh tokens rotate, so a host that later loses a login needs a re-push.
 */
export async function syncSealFleet(
  manager: SealAccountManager,
  targets: string[],
  accounts: string[] = []
): Promise<SealFleetSyncResult[]> {
  const call = transport
  if (!call) {
    throw new Error('Only the Seal desktop app can push accounts to other machines.')
  }
  // Keys stay sealed in the keychain of the machine they were added on; hosts keep their own.
  const config = { ...manager.getConfig(), apiKeys: [] }
  const credentials = await Promise.all(
    accounts.map(async (account) => {
      try {
        return { account, credential: await exportSealCredential(manager, account), error: null }
      } catch (error) {
        return { account, credential: null, error: errorMessage(error) }
      }
    })
  )
  return Promise.all(
    targets.map(async (environmentId): Promise<SealFleetSyncResult> => {
      let policyApplied = true
      try {
        const applied = await call(environmentId, 'seal.accounts.applyFleetConfig', {
          config,
          machineKey: `runtime:${environmentId}`
        })
        policyApplied = !(
          applied &&
          typeof applied === 'object' &&
          'policyApplied' in applied &&
          applied.policyApplied === false
        )
      } catch (error) {
        return {
          environmentId,
          ok: false,
          error: errorMessage(error),
          policyApplied: false,
          credentials: []
        }
      }
      const results: SealFleetSyncResult['credentials'] = []
      for (const entry of credentials) {
        if (!entry.credential) {
          results.push({ account: entry.account, ok: false, error: entry.error })
          continue
        }
        try {
          await call(environmentId, 'seal.accounts.importCredential', entry.credential)
          results.push({ account: entry.account, ok: true, error: null })
          recordFleetCopies(manager, environmentId, [manager.resolveKey(entry.account)])
        } catch (error) {
          results.push({ account: entry.account, ok: false, error: errorMessage(error) })
        }
      }
      return { environmentId, ok: true, error: null, policyApplied, credentials: results }
    })
  )
}
