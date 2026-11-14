import { describe, expect, it } from 'vitest'
import { classifyClaudeBilling, type ClaudeBillingSignals } from './claude-account-billing'
import {
  CLAUDE_LOGIN_FIXTURES,
  type ClaudeSubscriberLoginFixture as SubscriberFixture
} from './claude-account-billing.test-fixture'

/** The fields Claude Code saved at sign-in: what Seal reads without asking Anthropic. */
function savedSignals(fixture: SubscriberFixture): ClaudeBillingSignals {
  const oauth = fixture.credentials.claudeAiOauth
  return {
    subscriptionType: oauth.subscriptionType,
    rateLimitTier: oauth.rateLimitTier,
    scopes: oauth.scopes,
    billingType: fixture.oauthAccount.billingType
  }
}

/** The organization block of the login's OAuth profile. */
function profileSignals(fixture: {
  profile: { organization: SubscriberFixture['profile']['organization'] }
}): ClaudeBillingSignals {
  const organization = fixture.profile.organization
  return {
    organizationType: organization.organization_type,
    rateLimitTier: organization.rate_limit_tier,
    billingType: organization.billing_type
  }
}

describe('classifyClaudeBilling', () => {
  it.each([
    ['personalPro', 'pro', 'Pro'],
    ['personalMax5x', 'max', 'Max 5x'],
    ['personalMax20x', 'max', 'Max 20x'],
    ['team', 'team', 'Team'],
    ['enterprise', 'enterprise', 'Enterprise']
  ] as const)('reads a %s login as a subscription from its saved fields', (name, plan, label) => {
    expect(classifyClaudeBilling(savedSignals(CLAUDE_LOGIN_FIXTURES[name]))).toEqual({
      kind: 'subscription',
      plan,
      label
    })
  })

  it.each([
    ['personalPro', 'Pro'],
    ['personalMax20x', 'Max 20x'],
    ['team', 'Team'],
    ['enterprise', 'Enterprise']
  ] as const)('reads a %s login as a subscription from its OAuth profile', (name, label) => {
    const billing = classifyClaudeBilling(profileSignals(CLAUDE_LOGIN_FIXTURES[name]))
    expect(billing.kind).toBe('subscription')
    expect(billing.label).toBe(label)
  })

  it('keeps a Team seat a subscription when its credentials name no plan', () => {
    const fixture = CLAUDE_LOGIN_FIXTURES.teamWithoutSavedPlan
    expect(classifyClaudeBilling(savedSignals(fixture))).toEqual({
      kind: 'subscription',
      plan: null,
      label: null
    })
    expect(classifyClaudeBilling(profileSignals(fixture))).toEqual({
      kind: 'subscription',
      plan: 'team',
      label: 'Team'
    })
  })

  it('does not let an API key beside the login turn a plan seat into API billing', () => {
    expect(
      classifyClaudeBilling({ ...savedSignals(CLAUDE_LOGIN_FIXTURES.enterprise), apiKey: true })
    ).toEqual({ kind: 'subscription', plan: 'enterprise', label: 'Enterprise' })
  })

  it('reads an API key as API billing', () => {
    expect(classifyClaudeBilling({ apiKey: true })).toEqual({
      kind: 'api',
      plan: null,
      label: null
    })
  })

  it('reads a Console organization as API billing', () => {
    expect(classifyClaudeBilling(profileSignals(CLAUDE_LOGIN_FIXTURES.consoleApi)).kind).toBe('api')
    expect(classifyClaudeBilling({ scopes: ['org:create_api_key', 'user:profile'] }).kind).toBe(
      'api'
    )
  })

  it('claims nothing when the login says nothing about billing', () => {
    expect(classifyClaudeBilling({})).toEqual({ kind: null, plan: null, label: null })
    expect(classifyClaudeBilling({ scopes: ['user:profile'], billingType: 'none' }).kind).toBe(null)
  })
})
