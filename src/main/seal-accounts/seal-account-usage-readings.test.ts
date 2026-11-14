import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeManagedAccountSummary } from '../../shared/managed-account-types'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { createEmptyRateLimitState } from '../../shared/rate-limit-state-factory'
import { buildSealCandidates } from '../../shared/seal-accounts/seal-account-candidate-builder'
import { sealAccountRateLimit } from '../../shared/seal-accounts/seal-account-rate-limit'
import { defaultSealAccountsConfig } from '../../shared/seal-accounts/seal-accounts-config'
import { fetchActiveClaudeRateLimits } from '../rate-limits/providers/claude/claude-active-usage-fetch'
import {
  claudeUsageAtLimit,
  claudeUsageCheckThrottled,
  claudeUsageLoginRevoked,
  claudeUsageNearLimit,
  claudeUsageWithRoom,
  type FakeUsageResponse
} from '../rate-limits/providers/claude/claude-oauth-usage-responses.test-fixture'

const NOW = Date.UTC(2026, 10, 14, 12, 0)
const MINUTE = 60_000
const HOUR = 60 * MINUTE

const responses = vi.hoisted((): { byToken: Record<string, FakeUsageResponse> } => ({
  byToken: {}
}))

vi.mock('../network/proxy-settings', () => ({
  ensureElectronProxyFromEnvironment: async () => {}
}))
vi.mock('../network/http-client', () => ({
  getMainHttpClient: () => ({
    fetch: async (_url: string, init: { headers: Record<string, string> }) => {
      const reply = responses.byToken[init.headers.Authorization.replace('Bearer ', '')]
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: reply.headers
      })
    }
  })
}))
vi.mock('../rate-limits/providers/claude/claude-oauth-credentials', () => ({
  resolveClaudeOAuthCredentialReadOptions: (preparation: { configDir: string }) => ({
    credentialsFileConfigDir: preparation.configDir
  }),
  readClaudeOAuthCredentials: async (options: { credentialsFileConfigDir: string }) => ({
    token: options.credentialsFileConfigDir,
    hasRefreshableCredentials: true,
    source: 'credentials-file'
  })
}))

const ACCOUNTS = ['work', 'near', 'full', 'throttled', 'revoked'] as const
type AccountId = (typeof ACCOUNTS)[number]

function summary(id: AccountId): ClaudeManagedAccountSummary {
  return {
    id,
    email: `${id}@acme.dev`,
    authMethod: 'subscription-oauth',
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0
  }
}

function read(id: AccountId): Promise<ProviderRateLimits> {
  return fetchActiveClaudeRateLimits({
    authPreparation: { configDir: id, envPatch: {}, provenance: 'managed' }
  })
}

async function readAll(): Promise<Record<AccountId, ProviderRateLimits>> {
  return {
    work: await read('work'),
    near: await read('near'),
    full: await read('full'),
    throttled: await read('throttled'),
    revoked: await read('revoked')
  }
}

/** The accounts as Seal lists them, built from the rate-limit state the usage popover renders. */
function candidatesFrom(readings: Record<AccountId, ProviderRateLimits>, now: number) {
  const config = defaultSealAccountsConfig()
  const candidates = buildSealCandidates(
    {
      config,
      claude: { accounts: ACCOUNTS.map(summary), activeAccountId: 'work' },
      codex: { accounts: [], activeAccountId: null },
      rateLimits: createEmptyRateLimitState({
        claude: readings.work,
        inactiveClaudeAccounts: ACCOUNTS.filter((id) => id !== 'work').map((id) => ({
          accountId: id,
          rateLimits: readings[id],
          updatedAt: now,
          isFetching: false
        }))
      }),
      storedApiKeyIds: new Set(),
      systemLogins: { claude: null, codex: null },
      now
    },
    'claude'
  )
  return Object.fromEntries(
    candidates.map((candidate) => [
      candidate.localId,
      {
        session: candidate.limits?.session?.usedPercent ?? null,
        weekly: candidate.limits?.weekly?.usedPercent ?? null,
        health: candidate.health?.state,
        rateLimit: sealAccountRateLimit(candidate, { now })
      }
    ])
  )
}

describe('Seal accounts over real Claude usage responses', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    responses.byToken = {
      work: claudeUsageWithRoom(NOW),
      near: claudeUsageNearLimit(NOW),
      full: claudeUsageAtLimit(NOW),
      throttled: claudeUsageCheckThrottled(300),
      revoked: claudeUsageLoginRevoked()
    }
    return () => vi.useRealTimers()
  })

  it('reports rate limited only for the account whose window is full', async () => {
    expect(candidatesFrom(await readAll(), NOW)).toEqual({
      work: { session: 34, weekly: 61, health: 'ok', rateLimit: null },
      near: { session: 93, weekly: 78, health: 'ok', rateLimit: null },
      full: {
        session: 100,
        weekly: 88,
        health: 'ok',
        rateLimit: { resetsAt: NOW + HOUR + 47 * MINUTE }
      },
      // The usage endpoint refused the check: nothing is known, and nothing says "rate limited".
      throttled: { session: null, weekly: null, health: 'ok', rateLimit: null },
      revoked: { session: null, weekly: null, health: 'dead', rateLimit: null }
    })
  })

  it('keeps the throttled check as a retry time on the reading, not as an account limit', async () => {
    const { throttled } = await readAll()
    expect(throttled.status).toBe('error')
    expect(throttled.usageMetadata).toMatchObject({
      failureKind: 'rate-limited',
      retryAtMs: NOW + 300_000
    })
  })

  it('clears rate limited once the full window resets', async () => {
    const readings = await readAll()
    const afterReset = NOW + 2 * HOUR
    expect(candidatesFrom(readings, afterReset).full.rateLimit).toBeNull()
  })

  it("gives the machine's own unsaved login its own reading while a saved account is selected", async () => {
    const { work, near } = await readAll()
    const systemRow = (identity: string) =>
      buildSealCandidates(
        {
          config: defaultSealAccountsConfig(),
          claude: { accounts: [summary('work')], activeAccountId: 'work' },
          codex: { accounts: [], activeAccountId: null },
          rateLimits: createEmptyRateLimitState({
            claude: work,
            systemLoginUsage: { claude: { identity, rateLimits: near, isFetching: false } }
          }),
          storedApiKeyIds: new Set(),
          systemLogins: {
            claude: { email: 'me@acme.dev', scope: null, orgName: null },
            codex: null
          },
          now: NOW
        },
        'claude'
      ).find((candidate) => candidate.kind === 'system')

    expect(systemRow('claude:me@acme.dev')?.limits?.session?.usedPercent).toBe(93)
    expect(systemRow('claude:someone-else@acme.dev')?.limits).toBeNull()
  })
})
