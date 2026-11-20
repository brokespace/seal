import { describe, expect, it } from 'vitest'
import { createEmptyRateLimitState } from '../../../../src/shared/rate-limit-state-factory'
import type { ProviderRateLimits } from '../../../../src/shared/rate-limit-types'
import { buildSealCandidates } from '../../../../src/shared/seal-accounts/seal-account-candidate-builder'
import { sealAccountRateLimit } from '../../../../src/shared/seal-accounts/seal-account-rate-limit'
import { defaultSealAccountsConfig } from '../../../../src/shared/seal-accounts/seal-accounts-config'
import { sealAccountsStatusSchema } from './seal-accounts-schemas'

const NOW = Date.UTC(2026, 10, 14, 12, 0)
const HOUR = 3_600_000

function reading(session: number, weekly: number): ProviderRateLimits {
  return {
    provider: 'claude',
    session: {
      usedPercent: session,
      windowMinutes: 300,
      resetsAt: NOW + 2 * HOUR,
      resetDescription: null
    },
    weekly: {
      usedPercent: weekly,
      windowMinutes: 10_080,
      resetsAt: NOW + 72 * HOUR,
      resetDescription: null
    },
    updatedAt: NOW,
    error: null,
    status: 'ok'
  }
}

/** The status a host sends: its candidates built from the rate-limit state, then put on the wire. */
function hostStatus(): unknown {
  const config = defaultSealAccountsConfig()
  const account = (id: string) => ({
    id,
    email: `${id}@acme.dev`,
    authMethod: 'subscription-oauth' as const,
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0
  })
  const candidates = buildSealCandidates(
    {
      config,
      claude: { accounts: [account('near'), account('full')], activeAccountId: 'near' },
      codex: { accounts: [], activeAccountId: null },
      rateLimits: createEmptyRateLimitState({
        claude: reading(93, 78),
        inactiveClaudeAccounts: [
          { accountId: 'full', rateLimits: reading(100, 88), updatedAt: NOW, isFetching: false }
        ]
      }),
      storedApiKeyIds: new Set(),
      systemLogins: { claude: null, codex: null },
      now: NOW
    },
    'claude'
  ).map((candidate) => ({ ...candidate, rateLimit: sealAccountRateLimit(candidate, { now: NOW }) }))
  return JSON.parse(
    JSON.stringify({
      machineKey: 'local',
      config,
      providers: { claude: { candidates, machineDefault: null, lastDecision: null } },
      quarantine: {},
      swapLog: [],
      sessions: []
    })
  )
}

describe('the Seal accounts status a phone reads', () => {
  it("carries each account's usage reading and rate limit as the host holds them", () => {
    const status = sealAccountsStatusSchema.parse(hostStatus())
    expect(
      status.providers.claude.candidates.map((candidate) => [
        candidate.email,
        candidate.limits?.session?.usedPercent,
        candidate.limits?.weekly?.usedPercent,
        candidate.rateLimit ?? null
      ])
    ).toEqual([
      ['near@acme.dev', 93, 78, null],
      ['full@acme.dev', 100, 88, { resetsAt: NOW + 2 * HOUR }]
    ])
  })
})
