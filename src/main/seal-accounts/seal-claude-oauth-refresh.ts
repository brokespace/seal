// Claude Code's public OAuth client and token endpoint; the same refresh grant the CLI sends.
const CLAUDE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
// Runs while Claude's refresh locks are held, so it must finish well inside Claude's own wait.
const REFRESH_TIMEOUT_MS = 5_000

export type SealClaudeRefreshedTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
  scopes: string[] | null
}

/**
 * `invalid_grant`: this refresh token is spent or revoked, so the login needs a new sign-in.
 * `invalid_client`: the client id itself was refused, which says nothing about this login.
 * `transient`: network or server trouble; the token may still be good.
 */
export type SealClaudeRefreshError = 'invalid_grant' | 'invalid_client' | 'transient'

export class SealClaudeRefreshFailed extends Error {
  constructor(readonly kind: SealClaudeRefreshError) {
    super(
      kind === 'invalid_grant'
        ? 'Claude refused the saved login; sign in to it again.'
        : `Claude login refresh failed (${kind}).`
    )
  }
}

function field(record: unknown, name: string): unknown {
  return typeof record === 'object' && record !== null && name in record
    ? Object.getOwnPropertyDescriptor(record, name)?.value
    : undefined
}

/** Classifies a 4xx by the RFC 6749 `error` member only; anything ambiguous stays transient. */
async function refusalKind(response: Response): Promise<SealClaudeRefreshError> {
  if (![400, 401, 403].includes(response.status)) {
    return 'transient'
  }
  try {
    const error = field(await response.json(), 'error')
    return error === 'invalid_grant' || error === 'invalid_client' ? error : 'transient'
  } catch {
    return 'transient'
  }
}

/** Trades a refresh token for a new pair. The old refresh token stops working once this succeeds. */
export async function refreshClaudeOAuthToken(
  refreshToken: string,
  options: { fetch?: typeof fetch; now?: () => number } = {}
): Promise<SealClaudeRefreshedTokens> {
  const send = options.fetch ?? fetch
  let response: Response
  try {
    response = await send(CLAUDE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID
      }),
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS)
    })
  } catch {
    throw new SealClaudeRefreshFailed('transient')
  }
  if (!response.ok) {
    // Never surface the body: it may echo the token.
    throw new SealClaudeRefreshFailed(await refusalKind(response))
  }
  const body: unknown = await response.json().catch(() => null)
  const accessToken = field(body, 'access_token')
  const expiresIn = field(body, 'expires_in')
  const nextRefresh = field(body, 'refresh_token')
  const scope = field(body, 'scope')
  if (typeof accessToken !== 'string' || typeof expiresIn !== 'number') {
    throw new SealClaudeRefreshFailed('transient')
  }
  return {
    accessToken,
    refreshToken: typeof nextRefresh === 'string' && nextRefresh ? nextRefresh : null,
    expiresAt: (options.now ?? Date.now)() + expiresIn * 1000,
    scopes: typeof scope === 'string' && scope ? scope.split(' ') : null
  }
}
