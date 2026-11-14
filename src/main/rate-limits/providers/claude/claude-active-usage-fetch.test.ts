import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLAUDE_LOGIN_FIXTURES } from '../../../../shared/claude-account-billing.test-fixture'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { setMainHttpClient } from '../../../network/http-client'
import { fetchActiveClaudeRateLimits } from './claude-active-usage-fetch'
import { resetClaudeOAuthProfileCacheForTests } from './claude-oauth-profile-request'

vi.mock('./claude-oauth-usage-request', () => ({
  fetchClaudeOAuthUsage: async (): Promise<ProviderRateLimits> => ({
    provider: 'claude',
    session: { usedPercent: 12, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: 1,
    error: null,
    status: 'ok'
  })
}))
// The Keychain is this computer's own login; these fixtures live in a temp folder.
vi.mock('../../../claude-accounts/runtime-auth/keychain', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readActiveClaudeKeychainCredentialsStrict: async () => null
}))

type LoginFixture = {
  credentials: object
  oauthAccount: object | null
  profile: object | null
  primaryApiKey?: string
}

let home: string
let profileRequests: number

/** Writes one login the way Claude Code leaves it and reads its usage as the machine's own login. */
async function readSystemLogin(fixture: LoginFixture): Promise<ProviderRateLimits> {
  await writeFile(join(home, '.credentials.json'), JSON.stringify(fixture.credentials))
  await writeFile(
    join(home, '.claude.json'),
    JSON.stringify({
      ...(fixture.oauthAccount ? { oauthAccount: fixture.oauthAccount } : {}),
      ...(fixture.primaryApiKey ? { primaryApiKey: fixture.primaryApiKey } : {})
    })
  )
  setMainHttpClient({
    proxySession: () => null,
    fetch: async () => {
      profileRequests += 1
      return fixture.profile
        ? new Response(JSON.stringify(fixture.profile), { status: 200 })
        : new Response('{}', { status: 401 })
    }
  })
  return fetchActiveClaudeRateLimits({
    authPreparation: { configDir: home, envPatch: {}, provenance: 'system' }
  })
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'seal-claude-billing-'))
  profileRequests = 0
  vi.stubEnv('CLAUDE_CONFIG_DIR', home)
  resetClaudeOAuthProfileCacheForTests()
})

afterEach(async () => {
  setMainHttpClient(null)
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})

describe('fetchActiveClaudeRateLimits billing', () => {
  it.each([
    ['personalPro', 'Pro'],
    ['personalMax5x', 'Max 5x'],
    ['personalMax20x', 'Max 20x'],
    ['team', 'Team'],
    ['enterprise', 'Enterprise']
  ] as const)('reports a %s login as a subscription on its plan', async (name, plan) => {
    const limits = await readSystemLogin(CLAUDE_LOGIN_FIXTURES[name])

    expect(limits).toMatchObject({ status: 'ok', error: null, billing: 'subscription' })
    expect(limits.planType).toBe(plan)
    // The saved plan fields were enough; Anthropic was not asked again.
    expect(profileRequests).toBe(0)
  })

  it('asks the OAuth profile for the plan when the saved login names none', async () => {
    const limits = await readSystemLogin(CLAUDE_LOGIN_FIXTURES.teamWithoutSavedPlan)

    expect(limits).toMatchObject({ status: 'ok', billing: 'subscription', planType: 'Team' })
    expect(profileRequests).toBe(1)
  })

  it('keeps a seat a subscription when the profile request fails', async () => {
    const limits = await readSystemLogin({
      ...CLAUDE_LOGIN_FIXTURES.teamWithoutSavedPlan,
      profile: null
    })

    expect(limits).toMatchObject({ status: 'ok', billing: 'subscription' })
    expect(limits.planType).toBeUndefined()
  })

  it('does not call a signed-in seat API billing when its token cannot be read', async () => {
    const limits = await readSystemLogin({ ...CLAUDE_LOGIN_FIXTURES.team, credentials: {} })

    expect(limits.error).toBe("Seal cannot read this login's token, so its usage is unknown.")
    expect(limits.billing).toBe('subscription')
    expect(limits.usageMetadata?.failureKind).toBe('usage-unavailable')
  })

  it('reports a Console login as API key billing', async () => {
    const limits = await readSystemLogin(CLAUDE_LOGIN_FIXTURES.consoleApi)

    expect(limits.error).toBe('No subscription plan — API key billing')
    expect(limits.billing).toBe('api')
  })

  it('keeps the API key wording where nobody is signed in', async () => {
    const limits = await readSystemLogin(CLAUDE_LOGIN_FIXTURES.apiKeyOnly)

    expect(limits.error).toBe('No subscription plan — API key billing')
    expect(limits.billing).toBeUndefined()
  })
})
