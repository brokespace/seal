import { describe, expect, it } from 'vitest'
import { claudeLoginMatchesAccount, sealAccountHealth } from './seal-account-health'

const BASE = {
  now: 1_800_000_000_000,
  authFailure: false,
  needsSignIn: false,
  missingSecret: false,
  setupTokenCreatedAt: null
}

describe('sealAccountHealth', () => {
  it('flags a copied login that can neither renew nor say when it ends', () => {
    const health = sealAccountHealth({
      ...BASE,
      expiry: { expiresAt: null, refreshable: false, stranded: true }
    })
    expect(health).toEqual({ state: 'dead', reason: 'no-refresh' })
  })

  it('flags a login stored under an account of another plan', () => {
    expect(claudeLoginMatchesAccount('team', 'claude_max')).toBe(false)
    expect(claudeLoginMatchesAccount('max', 'claude_max')).toBe(true)
    const health = sealAccountHealth({
      ...BASE,
      expiry: { expiresAt: null, refreshable: true, wrongLogin: true }
    })
    expect(health).toEqual({ state: 'dead', reason: 'wrong-login' })
  })
})
