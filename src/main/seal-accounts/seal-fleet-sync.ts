import { SEAL_PROVIDERS } from '../../shared/seal-accounts/seal-accounts-config'
import { findCandidateByRef } from '../../shared/seal-accounts/seal-launch-account-pick'
import type { SealAccountsImportCredential } from '../../shared/rpc-contract/seal-accounts-params'
import type { SealAccountManager } from './seal-account-manager'
import { exportClaudeCredential, exportCodexCredential } from './seal-credential-transfer'

/** Desktop main sets this to reach paired remote runtimes; orcad leaves it unset. */
export type SealFleetTransport = (
  environmentId: string,
  method: string,
  params: unknown
) => Promise<unknown>

export type SealFleetSyncResult = {
  environmentId: string
  ok: boolean
  error: string | null
  credentials: { account: string; ok: boolean; error: string | null }[]
}

let transport: SealFleetTransport | null = null

export function setSealFleetTransport(next: SealFleetTransport | null): void {
  transport = next
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
    return provider === 'claude'
      ? exportClaudeCredential(manager.services, candidate)
      : exportCodexCredential(candidate, (id) => manager.codexHome(id))
  }
  throw new Error(`No account matches "${ref}".`)
}

/**
 * Pushes this desktop's policy, and any logins asked for, to paired remote runtimes. Each host
 * then swaps on its own. Refresh tokens rotate, so a host that later loses a login needs a re-push.
 */
export async function syncSealFleet(
  manager: SealAccountManager,
  environmentIds: string[],
  accounts: string[] = []
): Promise<SealFleetSyncResult[]> {
  const call = transport
  if (!call) {
    throw new Error('Only the Seal desktop app can push accounts to other machines.')
  }
  const config = manager.getConfig()
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
    environmentIds.map(async (environmentId): Promise<SealFleetSyncResult> => {
      try {
        await call(environmentId, 'seal.accounts.applyFleetConfig', {
          config,
          machineKey: `runtime:${environmentId}`
        })
      } catch (error) {
        return { environmentId, ok: false, error: errorMessage(error), credentials: [] }
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
        } catch (error) {
          results.push({ account: entry.account, ok: false, error: errorMessage(error) })
        }
      }
      return { environmentId, ok: true, error: null, credentials: results }
    })
  )
}
