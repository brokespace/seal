import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeSecureFile } from '../../shared/secure-storage/secure-file'
import type { SealAccountKey, SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import { sealAccountKeysMatch } from '../../shared/seal-accounts/seal-account-key'
import {
  credentialFreshness,
  needsRefresh,
  newestCopy,
  parseClaudeOAuth,
  refreshMarginMs,
  withRefreshedClaudeTokens
} from '../../shared/seal-accounts/seal-credential-freshness'
import type { SealAccountManager } from './seal-account-manager'
import { withClaudeConfigLocks } from './seal-claude-config-lock'
import {
  readClaudeHomeCredentials,
  readClaudeOAuthAccount,
  writeClaudeHomeCredentials
} from './seal-claude-home-credentials'
import { refreshClaudeOAuthToken } from './seal-claude-oauth-refresh'

type CopiesManager = Pick<
  SealAccountManager,
  'services' | 'store' | 'codexHome' | 'now' | 'machineKey'
>

export type SealLoginReconcile = {
  /** Freshness of the copy every home now holds; null when no copy has a login. */
  freshness: number | null
  refreshed: boolean
  /** Homes that were behind and got the newest copy. */
  updated: number
}

const queues = new Map<string, Promise<unknown>>()

/** One reconcile per login at a time inside this process; Claude's locks cover other processes. */
function serialized<T>(key: string, run: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).then(run, run)
  const settled = next.catch(() => {})
  queues.set(key, settled)
  void settled.then(() => {
    if (queues.get(key) === settled) {
      queues.delete(key)
    }
  })
  return next
}

/** Live session homes that hold a copy of this login. */
export function sessionHomesFor(
  manager: Pick<SealAccountManager, 'store'>,
  provider: SealProvider,
  accountKey: SealAccountKey
): string[] {
  return manager.store
    .getState()
    .sessions.filter(
      (session) =>
        session.provider === provider &&
        session.profileHome &&
        session.accountKey &&
        sealAccountKeysMatch(session.accountKey, accountKey)
    )
    .map((session) => session.profileHome ?? '')
}

/** Whether another machine also holds this login, so its refresh token is shared. */
export function loginIsCopied(manager: Pick<SealAccountManager, 'store'>, key: string): boolean {
  return Object.values(manager.store.getState().fleetCopies).some((keys) =>
    keys.some((entry) => sealAccountKeysMatch(entry, key))
  )
}

function sameClaudeIdentity(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null
): boolean {
  if (!a || !b || typeof a.emailAddress !== 'string') {
    return false
  }
  const org = (value: Record<string, unknown>) =>
    typeof value.organizationUuid === 'string' ? value.organizationUuid : null
  return (
    a.emailAddress.toLowerCase() === String(b.emailAddress).toLowerCase() &&
    (org(a) === null || org(b) === null || org(a) === org(b))
  )
}

/**
 * The account home plus each session home still signed in as the same account. A session that
 * ran `/login` as someone else is left out: copying its token into the account would destroy the
 * account's only refresh token.
 */
async function claudeCopyHomes(
  manager: CopiesManager,
  accountId: string,
  accountKey: SealAccountKey
): Promise<string[]> {
  const accountHome = manager.services.claudeRuntimeAuth.router.accountHome(accountId)
  const identity = await readClaudeOAuthAccount(accountHome)
  const sessions: string[] = []
  for (const home of sessionHomesFor(manager, 'claude', accountKey)) {
    if (sameClaudeIdentity(identity, await readClaudeOAuthAccount(home))) {
      sessions.push(home)
    }
  }
  return [accountHome, ...sessions]
}

/**
 * Brings every copy of one Claude login on this host to the newest one, refreshing it first when
 * it is near expiry and shared. A refresh token works once, so the refresh runs under Claude's
 * locks on every copy and its successor lands in the account home first, then everywhere else.
 * Claude Code itself refreshes about five minutes before expiry; Seal's earlier margin means only
 * one holder ever spends the token.
 */
export function reconcileClaudeLogin(
  manager: CopiesManager,
  args: { accountId: string; accountKey: SealAccountKey; fetch?: typeof fetch }
): Promise<SealLoginReconcile> {
  return serialized(`claude:${args.accountId}`, async () => {
    const homes = await claudeCopyHomes(manager, args.accountId, args.accountKey)
    const shared = homes.length > 1 || loginIsCopied(manager, args.accountKey)
    return withClaudeConfigLocks(homes, async () => {
      const copies = await Promise.all(
        homes.map(async (home) => {
          const json = await readClaudeHomeCredentials(home)
          return { home, json, freshness: json ? credentialFreshness('claude', json) : null }
        })
      )
      const newest = newestCopy(copies.filter((copy) => copy.json !== null))
      if (!newest?.json) {
        return { freshness: null, refreshed: false, updated: 0 }
      }
      let target = newest.json
      let freshness = newest.freshness
      let refreshed = false
      const oauth = parseClaudeOAuth(target)
      const margin = refreshMarginMs(manager.machineKey === 'local' ? 'vault' : 'remote')
      if (shared && oauth?.refreshToken && needsRefresh(oauth.expiresAt, manager.now(), margin)) {
        try {
          const tokens = await refreshClaudeOAuthToken(oauth.refreshToken, {
            fetch: args.fetch,
            now: manager.now
          })
          target = withRefreshedClaudeTokens(target, tokens)
          freshness = tokens.expiresAt
          refreshed = true
        } catch (error) {
          // Claude Code still refreshes on its own five minutes before expiry.
          console.warn('[seal-accounts]', error instanceof Error ? error.message : String(error))
        }
      }
      // copies[0] is the account home: the successor must reach it even if a session write fails.
      let updated = 0
      const failures: unknown[] = []
      for (const copy of copies) {
        if (copy.json === target) {
          continue
        }
        try {
          await writeClaudeHomeCredentials(copy.home, target)
          updated += 1
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length > 0 && updated === 0) {
        throw failures[0]
      }
      return { freshness, refreshed, updated }
    })
  })
}

/** Codex keeps no lock file, so copies just converge on the newest `auth.json`. */
export function reconcileCodexLogin(
  manager: CopiesManager,
  args: { accountId: string; accountKey: SealAccountKey }
): Promise<SealLoginReconcile> {
  return serialized(`codex:${args.accountId}`, async () => {
    const accountHome = manager.codexHome(args.accountId)
    const homes = [
      ...(accountHome ? [accountHome] : []),
      ...sessionHomesFor(manager, 'codex', args.accountKey)
    ]
    const copies = await Promise.all(
      homes.map(async (home) => {
        const json = await readFile(join(home, 'auth.json'), 'utf8').catch(() => null)
        return { home, json, freshness: json ? credentialFreshness('codex', json) : null }
      })
    )
    const newest = newestCopy(copies.filter((copy) => copy.json !== null))
    if (!newest?.json) {
      return { freshness: null, refreshed: false, updated: 0 }
    }
    let updated = 0
    for (const copy of copies) {
      if (copy.json !== newest.json && (copy.freshness ?? -1) <= (newest.freshness ?? -1)) {
        writeSecureFile(join(copy.home, 'auth.json'), newest.json)
        updated += 1
      }
    }
    return { freshness: newest.freshness, refreshed: false, updated }
  })
}
