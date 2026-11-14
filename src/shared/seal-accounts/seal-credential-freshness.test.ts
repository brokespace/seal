import { describe, expect, it } from 'vitest'
import {
  credentialFreshness,
  needsRefresh,
  newestCopy,
  parseClaudeOAuth,
  planFleetCredentialSync,
  withRefreshedClaudeTokens
} from './seal-credential-freshness'

const claudeCreds = JSON.stringify({
  claudeAiOauth: {
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    expiresAt: 1_800_000_000_000,
    scopes: ['user:inference'],
    subscriptionType: 'max'
  }
})

function jwt(claims: Record<string, unknown>): string {
  return `h.${btoa(JSON.stringify(claims)).replaceAll('=', '')}.s`
}

describe('Claude credentials', () => {
  it('reads the token pair and expiry Claude Code stores', () => {
    expect(parseClaudeOAuth(claudeCreds)).toEqual({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresAt: 1_800_000_000_000
    })
    expect(parseClaudeOAuth('{"claudeAiOauth":{}}')).toBeNull()
  })

  it('swaps in refreshed tokens without dropping scopes or plan', () => {
    const next = withRefreshedClaudeTokens(claudeCreds, {
      accessToken: 'at-2',
      refreshToken: 'rt-2',
      expiresAt: 1_800_000_900_000
    })
    expect(JSON.parse(next)).toEqual({
      claudeAiOauth: {
        accessToken: 'at-2',
        refreshToken: 'rt-2',
        expiresAt: 1_800_000_900_000,
        scopes: ['user:inference'],
        subscriptionType: 'max'
      }
    })
  })
})

describe('credentialFreshness', () => {
  it('ranks Claude by expiry and Codex by access-token expiry, then last_refresh', () => {
    expect(credentialFreshness('claude', claudeCreds)).toBe(1_800_000_000_000)
    expect(
      credentialFreshness(
        'codex',
        JSON.stringify({ tokens: { access_token: jwt({ exp: 1_900 }) } })
      )
    ).toBe(1_900_000)
    expect(
      credentialFreshness('codex', JSON.stringify({ last_refresh: '2026-11-13T17:00:00.000Z' }))
    ).toBe(Date.UTC(2026, 10, 13, 17))
    expect(credentialFreshness('codex', 'not json')).toBeNull()
  })
})

describe('refresh timing', () => {
  it('refreshes inside the margin or when the expiry is unknown', () => {
    expect(needsRefresh(1_000 + 10 * 60_000, 1_000, 30 * 60_000)).toBe(true)
    expect(needsRefresh(1_000 + 45 * 60_000, 1_000, 30 * 60_000)).toBe(false)
    expect(needsRefresh(null, 1_000, 30 * 60_000)).toBe(true)
  })

  it('picks the freshest copy, keeping the first on a tie', () => {
    expect(
      newestCopy([
        { id: 'vault', freshness: 5 },
        { id: 'session', freshness: 9 },
        { id: 'other', freshness: 9 }
      ])?.id
    ).toBe('session')
    expect(newestCopy([{ id: 'vault', freshness: null }])?.id).toBe('vault')
  })
})

describe('planFleetCredentialSync', () => {
  it('pulls a host that refreshed, then pushes that copy to every stale host', () => {
    const plan = planFleetCredentialSync({ 'claude:a@x.io': 100, 'claude:b@x.io': 300 }, [
      { environmentId: 'box1', accounts: { 'claude:a@x.io': 200 } },
      { environmentId: 'box2', accounts: { 'claude:a@x.io': 100, 'claude:b@x.io': 300 } },
      { environmentId: 'box3', accounts: { 'claude:b@x.io': null } }
    ])
    expect(plan).toEqual({
      pulls: [{ environmentId: 'box1', account: 'claude:a@x.io' }],
      pushes: [
        { environmentId: 'box2', accounts: ['claude:a@x.io'] },
        { environmentId: 'box3', accounts: ['claude:b@x.io'] }
      ]
    })
  })

  it('does nothing when every copy matches the vault', () => {
    expect(
      planFleetCredentialSync({ 'claude:a@x.io': 100 }, [
        { environmentId: 'box1', accounts: { 'claude:a@x.io': 100 } }
      ])
    ).toEqual({ pulls: [], pushes: [] })
  })
})
