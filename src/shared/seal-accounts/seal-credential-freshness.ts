import type { SealAccountKey, SealProvider } from './seal-accounts-config'

/** Claude Code refreshes about five minutes before expiry; Seal must get there first. */
const DESKTOP_REFRESH_MARGIN_MS = 30 * 60_000
/** A remote host refreshes later, so a connected desktop (the vault) wins any refresh race. */
const REMOTE_REFRESH_MARGIN_MS = 10 * 60_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function parseJson(json: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(json))
  } catch {
    return null
  }
}

export type SealClaudeOAuth = {
  accessToken: string
  refreshToken: string | null
  /** Epoch ms the access token expires; Claude Code writes it beside the tokens. */
  expiresAt: number | null
}

export function parseClaudeOAuth(credentialsJson: string): SealClaudeOAuth | null {
  const oauth = asRecord(parseJson(credentialsJson)?.claudeAiOauth)
  if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) {
    return null
  }
  return {
    accessToken: oauth.accessToken,
    refreshToken: typeof oauth.refreshToken === 'string' ? oauth.refreshToken : null,
    expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null
  }
}

/** Claude Code's credentials JSON with a refreshed token pair, keeping its other fields. */
export function withRefreshedClaudeTokens(
  credentialsJson: string,
  refreshed: {
    accessToken: string
    refreshToken: string | null
    expiresAt: number
    scopes?: string[] | null
  }
): string {
  const root = parseJson(credentialsJson) ?? {}
  const oauth = asRecord(root.claudeAiOauth) ?? {}
  return JSON.stringify({
    ...root,
    claudeAiOauth: {
      ...oauth,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? oauth.refreshToken,
      expiresAt: refreshed.expiresAt,
      ...(refreshed.scopes ? { scopes: refreshed.scopes } : {})
    }
  })
}

function jwtExpiry(token: unknown): number | null {
  if (typeof token !== 'string') {
    return null
  }
  const payload = token.split('.')[1]
  if (!payload) {
    return null
  }
  try {
    const claims = asRecord(
      JSON.parse(globalThis.atob(payload.replaceAll('-', '+').replaceAll('_', '/')))
    )
    return typeof claims?.exp === 'number' ? claims.exp * 1000 : null
  } catch {
    return null
  }
}

/**
 * How new a stored login is: Claude's access-token expiry, or Codex's access-token expiry (falling
 * back to `last_refresh`). Every refresh moves it forward, so the larger copy holds the live
 * refresh token and every other copy of that login is stale.
 */
export function credentialFreshness(provider: SealProvider, json: string): number | null {
  if (provider === 'claude') {
    return parseClaudeOAuth(json)?.expiresAt ?? null
  }
  const auth = parseJson(json)
  const tokens = asRecord(auth?.tokens)
  const fromToken = jwtExpiry(tokens?.access_token)
  if (fromToken !== null) {
    return fromToken
  }
  const lastRefresh =
    typeof auth?.last_refresh === 'string' ? Date.parse(auth.last_refresh) : Number.NaN
  return Number.isFinite(lastRefresh) ? lastRefresh : null
}

export function refreshMarginMs(role: 'vault' | 'remote'): number {
  return role === 'vault' ? DESKTOP_REFRESH_MARGIN_MS : REMOTE_REFRESH_MARGIN_MS
}

export function needsRefresh(expiresAt: number | null, now: number, marginMs: number): boolean {
  return expiresAt === null || expiresAt - now <= marginMs
}

/** The copy every other one should match: the freshest, the first listed on a tie. */
export function newestCopy<T extends { freshness: number | null }>(copies: readonly T[]): T | null {
  let best: T | null = null
  for (const copy of copies) {
    if (best === null || (copy.freshness ?? -1) > (best.freshness ?? -1)) {
      best = copy
    }
  }
  return best
}

export type SealHostFreshness = {
  environmentId: string
  accounts: Record<SealAccountKey, number | null>
}

export type SealFleetCredentialPlan = {
  /** Pull this host's copy into the vault first: it refreshed and now holds the live token. */
  pulls: { environmentId: string; account: SealAccountKey }[]
  /** Then push the vault's (now newest) copy to every host still holding an older one. */
  pushes: { environmentId: string; accounts: SealAccountKey[] }[]
}

/** Reconcile one login's copies across the vault and the hosts it was copied to. */
export function planFleetCredentialSync(
  vault: Record<SealAccountKey, number | null>,
  hosts: readonly SealHostFreshness[]
): SealFleetCredentialPlan {
  const pulls: SealFleetCredentialPlan['pulls'] = []
  const newest: Record<SealAccountKey, number | null> = { ...vault }
  for (const account of Object.keys(vault)) {
    let source: string | null = null
    for (const host of hosts) {
      const remote = host.accounts[account]
      if (remote !== undefined && remote !== null && remote > (newest[account] ?? -1)) {
        newest[account] = remote
        source = host.environmentId
      }
    }
    if (source) {
      pulls.push({ environmentId: source, account })
    }
  }
  const pushes = hosts
    .map((host) => ({
      environmentId: host.environmentId,
      accounts: Object.keys(host.accounts).filter((account) => {
        const target = newest[account]
        const remote = host.accounts[account]
        return (
          target !== undefined &&
          target !== null &&
          (remote === null || remote === undefined || remote < target)
        )
      })
    }))
    .filter((push) => push.accounts.length > 0)
  return { pulls, pushes }
}
