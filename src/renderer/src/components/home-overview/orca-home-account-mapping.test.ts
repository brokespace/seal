import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits, RateLimitState } from '../../../../shared/rate-limit-types'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'
import type { ClaudeManagedAccount } from '../../../../shared/managed-account-types'
import { orcaHomeAccounts } from './orca-home-account-mapping'

function limits(overrides: Partial<ProviderRateLimits>): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: null,
    updatedAt: 1,
    error: null,
    status: 'ok',
    ...overrides
  }
}

function claudeAccount(id: string, email: string): ClaudeManagedAccount {
  return {
    id,
    email,
    managedAuthPath: `/tmp/${id}`,
    authMethod: 'subscription-oauth',
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0
  }
}

describe('orcaHomeAccounts', () => {
  it('lists configured providers with their windows and saved inactive accounts by email', () => {
    const state: RateLimitState = {
      ...createEmptyRateLimitState(),
      claude: limits({
        session: { usedPercent: 81, windowMinutes: 300, resetsAt: 7_000, resetDescription: null },
        weekly: { usedPercent: 12, windowMinutes: 10080, resetsAt: 90_000, resetDescription: null }
      }),
      gemini: limits({ provider: 'gemini', status: 'unavailable' }),
      inactiveClaudeAccounts: [{ accountId: 'b', rateLimits: null, updatedAt: 0, isFetching: true }]
    }
    const accounts = orcaHomeAccounts(state, {
      claudeManagedAccounts: [
        claudeAccount('a', 'work@example.com'),
        claudeAccount('b', 'home@example.com')
      ],
      activeClaudeManagedAccountId: 'a'
    })
    expect(accounts).toEqual([
      {
        id: 'claude:active',
        provider: 'claude',
        providerLabel: 'Claude',
        label: 'work@example.com',
        active: true,
        status: 'ok',
        windows: [
          { kind: 'session', usedPercent: 81, resetsAt: 7_000 },
          { kind: 'weekly', usedPercent: 12, resetsAt: 90_000 }
        ]
      },
      {
        id: 'claude:b',
        provider: 'claude',
        providerLabel: 'Claude',
        label: 'home@example.com',
        active: false,
        status: 'loading',
        windows: []
      }
    ])
  })
})
