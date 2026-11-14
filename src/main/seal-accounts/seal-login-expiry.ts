import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SEAL_PROVIDERS,
  type SealAccountKey
} from '../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import type { SealLoginExpiry } from '../../shared/seal-accounts/seal-account-health'
import {
  credentialFreshness,
  parseClaudeOAuth
} from '../../shared/seal-accounts/seal-credential-freshness'
import { getSystemCodexHomePath } from '../codex/configuration/homes/codex-home-paths'
import type { SealAccountManager } from './seal-account-manager'
import { readClaudeHomeCredentials } from './seal-claude-home-credentials'

const REFRESH_INTERVAL_MS = 10 * 60_000

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
    const json = await readClaudeHomeCredentials(home, { system })
    const oauth = json ? parseClaudeOAuth(json) : null
    return oauth ? { expiresAt: oauth.expiresAt, refreshable: oauth.refreshToken !== null } : null
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
  private readAt = 0
  private running: Promise<void> | null = null

  get(key: SealAccountKey): SealLoginExpiry | null {
    return this.entries.get(key) ?? null
  }

  invalidate(): void {
    this.readAt = 0
  }

  refresh(manager: ExpiryManager): Promise<void> {
    if (this.running) {
      return this.running
    }
    if (manager.now() - this.readAt < REFRESH_INTERVAL_MS) {
      return Promise.resolve()
    }
    this.running = this.read(manager).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async read(manager: ExpiryManager): Promise<void> {
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
  }
}
