import { describe, expect, it } from 'vitest'
import { refreshClaudeOAuthToken, type SealClaudeRefreshFailed } from './seal-claude-oauth-refresh'

function reply(status: number, body: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(body), { status })
}

describe('refreshClaudeOAuthToken', () => {
  it('returns the rotated pair with an absolute expiry and the granted scopes', async () => {
    const tokens = await refreshClaudeOAuthToken('rt-1', {
      fetch: reply(200, {
        access_token: 'at-2',
        refresh_token: 'rt-2',
        expires_in: 28_800,
        scope: 'user:inference user:profile'
      }),
      now: () => 1_000_000
    })
    expect(tokens).toEqual({
      accessToken: 'at-2',
      refreshToken: 'rt-2',
      expiresAt: 29_800_000,
      scopes: ['user:inference', 'user:profile']
    })
  })

  it('calls a login dead only when the server says invalid_grant', async () => {
    const kind = (status: number, body: unknown) =>
      refreshClaudeOAuthToken('rt-1', { fetch: reply(status, body) }).catch(
        (error: SealClaudeRefreshFailed) => error.kind
      )
    expect(await kind(400, { error: 'invalid_grant' })).toBe('invalid_grant')
    expect(await kind(401, { error: 'invalid_client' })).toBe('invalid_client')
    expect(await kind(400, { error: 'invalid_request', detail: 'invalid_grant' })).toBe('transient')
    expect(await kind(503, { error: 'invalid_grant' })).toBe('transient')
  })
})
