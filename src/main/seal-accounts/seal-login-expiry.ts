import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SEAL_PROVIDERS,
  type SealAccountKey
} from '../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import {
  claudeLoginMatchesAccount,
  type SealLoginExpiry
} from '../../shared/seal-accounts/seal-account-health'
import {
  credentialFreshness,
  parseClaudeOAuth
} from '../../shared/seal-accounts/seal-credential-freshness'
import { getSystemCodexHomePath } from '../codex/configuration/homes/codex-home-paths'
import type { SealAccountManager } from './seal-account-manager'
import { isClaudeRefreshRejected } from '../claude-accounts/runtime-auth/claude-refresh-rejections'
import {
  readClaudeHomeCredentialsResult,
  readClaudeOAuthAccount
} from './seal-claude-home-credentials'

const REFRESH_INTERVAL_MS = 10 * 60_000
// A lapsed access token with no recent renewal is how a dead login looks, so look again sooner.
const SUSPECT_INTERVAL_MS = 2 * 60_000

type ExpiryManager = Pick<SealAccountManager, 'baseCandidates' | 'services' | 'codexHome' | 'now'>

function hasCodexRefreshToken(authJson: string): boolean {
  try {
    const auth: unknown = JSON.parse(authJson)
    if (typeof auth !== 'object' || auth === null || !('tokens' in auth)) {
      return false
    }
    const tokens: unknown = auth.tokens
    return (
      typeof tokens === 'object' &&
      tokens !== null &&
      'refresh_token' in tokens &&
      typeof tokens.refresh_token === 'string' &&
      tokens.refresh_token.length > 0
    )
  } catch {
    return false
  }
}

async function readExpiry(
  manager: ExpiryManager,
  candidate: SealAccountCandidate
): Promise<SealLoginExpiry | null> {
  if (candidate.provider === 'claude') {
    const router = manager.services.claudeRuntimeAuth.router
    const system = candidate.localId === null
    const home = system ? router.systemDefaultHome() : router.accountHome(candidate.localId ?? '')
    const result = await readClaudeHomeCredentialsResult(home, { system })
    if (result.kind === 'unreadable') {
      return null
    }
    const oauth = result.kind === 'present' ? parseClaudeOAuth(result.json) : null
    const account = await readClaudeOAuthAccount(system ? undefined : home).catch(() => null)
    if (!oauth) {
      // The folder names a login but holds no token: Claude itself reports signed out.
      return result.kind === 'absent' && account
        ? { expiresAt: null, refreshable: false, missing: true }
        : null
    }
    const organizationType =
      typeof account?.organizationType === 'string' ? account.organizationType : null
    const refreshRejected =
      isClaudeRefreshRejected(oauth.refreshToken) ||
      (oauth.refreshTokenExpiresAt !== null && oauth.refreshTokenExpiresAt <= manager.now())
    return {
      expiresAt: oauth.expiresAt,
      refreshable: oauth.refreshToken !== null && !refreshRejected,
      stranded: oauth.refreshToken === null && oauth.expiresAt === null,
      wrongLogin: !claudeLoginMatchesAccount(oauth.subscriptionType, organizationType),
      ...(refreshRejected ? { refreshRejected } : {})
    }
  }
  const home =
    candidate.localId === null ? getSystemCodexHomePath() : manager.codexHome(candidate.localId)
  const json = home ? await readFile(join(home, 'auth.json'), 'utf8').catch(() => null) : null
  return json
    ? { expiresAt: credentialFreshness('codex', json), refreshable: hasCodexRefreshToken(json) }
    : null
}

/** Whether each stored login can renew itself; read off the hot path because macOS asks the keychain. */
export class SealLoginExpiryCache {
  private readonly entries = new Map<SealAccountKey, SealLoginExpiry>()
  private readonly listeners = new Set<() => void>()
  private readAt = 0
  private suspect = false
  private maxAgeMs = Infinity
  private running: Promise<void> | null = null

  get(key: SealAccountKey): SealLoginExpiry | null {
    return this.entries.get(key) ?? null
  }

  /** Forces the next refresh to re-read; with an age, only when the last read is older than it. */
  invalidate(olderThanMs = 0): void {
    this.maxAgeMs = Math.min(this.maxAgeMs, olderThanMs)
  }

  /** Called after a read that changed any entry, so account health is judged again. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  refresh(manager: ExpiryManager): Promise<void> {
    if (this.running) {
      // A read that began before an invalidation cannot answer it; the age check ends the chain.
      return this.running.then(() => this.refresh(manager))
    }
    const interval = this.suspect ? SUSPECT_INTERVAL_MS : REFRESH_INTERVAL_MS
    if (manager.now() - this.readAt < Math.min(interval, this.maxAgeMs)) {
      return Promise.resolve()
    }
    this.maxAgeMs = Infinity
    this.running = this.read(manager).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async read(manager: ExpiryManager): Promise<void> {
    const before = JSON.stringify([...this.entries])
    const seen = new Set<SealAccountKey>()
    for (const provider of SEAL_PROVIDERS) {
      for (const candidate of manager.baseCandidates(provider)) {
        if (candidate.kind === 'api-key' || !candidate.launchable) {
          continue
        }
        const expiry = await readExpiry(manager, candidate).catch(() => null)
        seen.add(candidate.key)
        if (expiry) {
          this.entries.set(candidate.key, expiry)
        } else {
          this.entries.delete(candidate.key)
        }
      }
    }
    for (const key of this.entries.keys()) {
      if (!seen.has(key)) {
        this.entries.delete(key)
      }
    }
    this.readAt = manager.now()
    this.suspect = [...this.entries.values()].some(
      (entry) => entry.expiresAt !== null && entry.expiresAt <= this.readAt
    )
    if (JSON.stringify([...this.entries]) !== before) {
      for (const listener of this.listeners) {
        listener()
      }
    }
  }
}
