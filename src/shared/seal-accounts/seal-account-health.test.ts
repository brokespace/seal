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

  it('calls a folder that names a login but holds no token signed out', () => {
    const health = sealAccountHealth({
      ...BASE,
      expiry: { expiresAt: null, refreshable: false, missing: true }
    })
    expect(health).toEqual({ state: 'dead', reason: 'signed-out' })
  })

  it('calls a login whose refresh token was refused expired, whatever its access token says', () => {
    const health = sealAccountHealth({
      ...BASE,
      expiry: { expiresAt: BASE.now + 3_600_000, refreshable: false, refreshRejected: true }
    })
    expect(health).toEqual({ state: 'dead', reason: 'expired' })
  })

  it('calls a lapsed login that cannot renew itself expired', () => {
    const health = sealAccountHealth({
      ...BASE,
      expiry: { expiresAt: BASE.now - 1, refreshable: false }
    })
    expect(health).toEqual({ state: 'dead', reason: 'expired' })
  })
})
