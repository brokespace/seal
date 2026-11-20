import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import {
  planSealAccountDedup,
  type SealDedupEntry
} from '../../shared/seal-accounts/seal-account-dedup'
import { oauthAccountKey } from '../../shared/seal-accounts/seal-account-key'
import type { SealMigrationNotice } from '../../shared/seal-accounts/seal-accounts-status'
import { credentialFreshness } from '../../shared/seal-accounts/seal-credential-freshness'
import type { SealAccountManager } from './seal-account-manager'
import { readClaudeHomeCredentials } from './seal-claude-home-credentials'

/** Bump when a later release needs to tell the user about another one-time merge. */
export const SEAL_ACCOUNTS_MIGRATION_VERSION = 1

type MigrationManager = Pick<SealAccountManager, 'services' | 'codexHome' | 'store' | 'now'>
type Merged = SealMigrationNotice['merged'][number]

async function claudeEntries(manager: MigrationManager): Promise<(SealDedupEntry & Labelled)[]> {
  const state = manager.services.claudeAccounts.listAccounts()
  const selected = state.activeAccountIdsByRuntime?.host ?? state.activeAccountId
  const router = manager.services.claudeRuntimeAuth.router
  const entries: (SealDedupEntry & Labelled)[] = []
  for (const account of state.accounts) {
    // A WSL account is a different install of Claude, never a copy of a host login.
    if (account.managedAuthRuntime === 'wsl') {
      continue
    }
    const usable = account.needsSignIn !== true
    const json = usable
      ? await readClaudeHomeCredentials(router.accountHome(account.id)).catch(() => null)
      : null
    entries.push({
      id: account.id,
      key: oauthAccountKey('claude', account.email, account.organizationUuid),
      label: account.email,
      active: selected === account.id,
      usable,
      freshness: json ? credentialFreshness('claude', json) : null,
      lastAuthenticatedAt: account.lastAuthenticatedAt
    })
  }
  return entries
}

async function codexEntries(manager: MigrationManager): Promise<(SealDedupEntry & Labelled)[]> {
  const state = manager.services.codexAccounts.listAccounts()
  const selected = state.activeAccountIdsByRuntime?.host ?? state.activeAccountId
  const entries: (SealDedupEntry & Labelled)[] = []
  for (const account of state.accounts) {
    if (account.managedHomeRuntime === 'wsl') {
      continue
    }
    const home = manager.codexHome(account.id)
    const json = home ? await readFile(join(home, 'auth.json'), 'utf8').catch(() => null) : null
    entries.push({
      id: account.id,
      key: oauthAccountKey('codex', account.email, account.workspaceAccountId),
      label: account.email,
      active: selected === account.id,
      usable: json !== null,
      freshness: json ? credentialFreshness('codex', json) : null,
      lastAuthenticatedAt: account.lastAuthenticatedAt
    })
  }
  return entries
}

type Labelled = { label: string }

/**
 * Collapses saved logins for the same identity into one. Profiles, rules and sessions follow the
 * account key, which every copy shares, so only the machine's selection needs re-pointing.
 */
export async function dedupeSealAccounts(manager: MigrationManager): Promise<Merged[]> {
  const merged: Merged[] = []
  for (const provider of ['claude', 'codex'] satisfies SealProvider[]) {
    const entries = await (provider === 'claude' ? claudeEntries(manager) : codexEntries(manager))
    const accounts =
      provider === 'claude' ? manager.services.claudeAccounts : manager.services.codexAccounts
    for (const group of planSealAccountDedup(entries)) {
      let removed = 0
      try {
        if (group.reselect) {
          await accounts.selectAccount(group.keep)
        }
        for (const id of group.remove) {
          await accounts.removeAccount(id)
          removed += 1
        }
      } catch (error) {
        // A copy still in use stays until the next start; the list already shows one row.
        console.warn(`[seal-accounts] Could not remove a duplicate ${provider} login:`, error)
      }
      if (removed > 0) {
        const label = entries.find((entry) => entry.id === group.keep)?.label ?? group.key
        merged.push({ provider, label, removed })
      }
    }
  }
  return merged
}

/** Runs on every start; the notice is recorded once, the first time anything was merged. */
export async function runSealAccountsMigration(manager: MigrationManager): Promise<void> {
  const merged = await dedupeSealAccounts(manager)
  const previous = manager.store.getState().accountsMigration
  if (previous?.version === SEAL_ACCOUNTS_MIGRATION_VERSION && merged.length === 0) {
    return
  }
  manager.store.updateState((next) => {
    next.accountsMigration = {
      version: SEAL_ACCOUNTS_MIGRATION_VERSION,
      notice: merged.length > 0 ? { at: manager.now(), merged } : (previous?.notice ?? null)
    }
  })
}
