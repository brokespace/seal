import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../../shared/rate-limit-types'
import { KeptUsageReadings } from './kept-usage-readings'
import { RateLimitService } from './rate-limit-service'
import { fetchInactiveClaudeAccountUsage } from '../providers/claude/claude-managed-account-usage'
import { okProvider, resetRateLimitProviderMocks } from './rate-limit-service-test-harness'

vi.mock('../providers/claude/claude-active-usage-fetch', () => ({
  fetchActiveClaudeRateLimits: vi.fn()
}))
vi.mock('../providers/claude/claude-managed-account-usage', () => ({
  fetchInactiveClaudeAccountUsage: vi.fn()
}))
vi.mock('../../claude-accounts/profiles/routing/claude-profile-installed-router', () => ({
  getClaudeProfileRouter: () => ({
    systemDefaultHome: () => '/home/me/.claude',
    userConfigDir: () => '/home/me/.claude'
  })
}))
vi.mock('../providers/codex/codex-fetcher', () => ({
  consumeCodexRateLimitResetCredit: vi.fn(),
  fetchCodexRateLimits: vi.fn()
}))
vi.mock('../providers/gemini/gemini-usage-fetcher', () => ({ fetchGeminiRateLimits: vi.fn() }))
vi.mock('../providers/kimi/kimi-fetcher', () => ({ fetchKimiRateLimits: vi.fn() }))
vi.mock('../providers/opencode-go/opencode-go-usage-source-selection', () => ({
  fetchOpenCodeGoUsage: vi.fn()
}))
vi.mock('../providers/zcode/zcode-usage-fetcher', () => ({ fetchZcodeRateLimits: vi.fn() }))
vi.mock('../providers/muse/muse-usage-fetcher', () => ({ fetchMuseRateLimits: vi.fn() }))
vi.mock('../providers/antigravity/antigravity-usage-fetcher', () => ({
  fetchAntigravityRateLimits: vi.fn()
}))
vi.mock('../providers/minimax/minimax-fetcher', () => ({ fetchMiniMaxRateLimits: vi.fn() }))
vi.mock('../providers/grok/grok-fetcher', () => ({ fetchGrokRateLimits: vi.fn() }))
vi.mock('../providers/cursor/cursor-fetcher', () => ({ fetchCursorRateLimits: vi.fn() }))
vi.mock('../providers/cursor/cursor-auth', () => ({ readCursorAuthSession: vi.fn() }))
vi.mock('../providers/grok/grok-auth', () => ({
  readGrokAuthSession: vi.fn(() => ({ status: 'missing' }))
}))
vi.mock('../../minimax/minimax-cookie-store', () => ({ hasMiniMaxSessionCookie: vi.fn() }))

const NOW = 1_700_000_000_000
const MINUTE = 60_000

function throttled(retryAtMs: number): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error: 'Claude is throttling usage checks right now.',
    status: 'error',
    usageMetadata: { failureKind: 'rate-limited', retryAtMs }
  }
}

function serviceWithAccounts(): RateLimitService {
  const service = new RateLimitService()
  service.setInactiveClaudeAccountsResolver(() => [{ id: 'side' }, { id: 'spare' }])
  return service
}

describe('one reading per account, whoever asks', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    resetRateLimitProviderMocks()
  })
  afterEach(() => vi.useRealTimers())

  it("gives a session's usage report to the account whose folder it runs in", () => {
    const service = serviceWithAccounts()
    service.setLiveClaudeUsageOwnerResolver((event) =>
      event.configDir === '/sessions/abc/home' ? { kind: 'account', accountId: 'side' } : null
    )

    service.ingestLiveClaudeRateLimits({
      configDir: '/sessions/abc/home',
      fiveHour: { used_percentage: 44 },
      sevenDay: { used_percentage: 71 }
    })
    service.ingestLiveClaudeRateLimits({
      configDir: '/somewhere/else',
      fiveHour: { used_percentage: 99 },
      sevenDay: null
    })

    expect(service.getState().claude).toBeNull()
    expect(service.getState().inactiveClaudeAccounts).toEqual([
      {
        accountId: 'side',
        rateLimits: expect.objectContaining({
          session: expect.objectContaining({ usedPercent: 44 }),
          weekly: expect.objectContaining({ usedPercent: 71 }),
          status: 'ok'
        }),
        updatedAt: NOW,
        isFetching: false
      }
    ])
  })

  it("keeps a session's report when the usage endpoint then refuses the account's check", async () => {
    const service = serviceWithAccounts()
    service.setLiveClaudeUsageOwnerResolver(() => ({ kind: 'account', accountId: 'side' }))
    service.ingestLiveClaudeRateLimits({
      configDir: '/sessions/abc/home',
      fiveHour: { used_percentage: 44 },
      sevenDay: null
    })
    vi.mocked(fetchInactiveClaudeAccountUsage).mockResolvedValue(throttled(NOW + 5 * MINUTE))

    const reading = await service.readAccountUsage('claude', 'side')

    expect(reading).toMatchObject({
      status: 'ok',
      session: { usedPercent: 44 },
      usageMetadata: { retryAtMs: NOW + 5 * MINUTE }
    })
  })

  it('does not ask the endpoint twice when a switcher opens and Seal asks for the same account', async () => {
    const service = serviceWithAccounts()
    vi.mocked(fetchInactiveClaudeAccountUsage).mockResolvedValue(okProvider('claude', 12))

    await service.fetchInactiveClaudeAccountsOnOpen()
    const again = await service.readAccountUsage('claude', 'side')

    expect(again?.session?.usedPercent).toBe(12)
    expect(
      vi.mocked(fetchInactiveClaudeAccountUsage).mock.calls.map(([account]) => account.id)
    ).toEqual(['side', 'spare'])
  })

  it('backs off an account whose checks keep failing, and reads it at once after a new sign-in', async () => {
    const service = serviceWithAccounts()
    vi.mocked(fetchInactiveClaudeAccountUsage).mockResolvedValue({
      ...throttled(0),
      usageMetadata: { failureKind: 'stale-token' }
    })
    await service.readAccountUsage('claude', 'side')
    vi.setSystemTime(NOW + 31_000)
    await service.readAccountUsage('claude', 'side')
    // Two failures: the next check waits a minute, not the 30-second floor.
    vi.setSystemTime(NOW + 31_000 + 45_000)
    await service.readAccountUsage('claude', 'side')
    expect(fetchInactiveClaudeAccountUsage).toHaveBeenCalledTimes(2)

    service.forgetAccountReadAttempts('claude', 'side')
    vi.mocked(fetchInactiveClaudeAccountUsage).mockResolvedValue(okProvider('claude', 3))
    const fresh = await service.readAccountUsage('claude', 'side')
    expect(fresh).toMatchObject({ status: 'ok', session: { usedPercent: 3 } })
  })
})

describe('last good reading across a restart', () => {
  let dir: string
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    resetRateLimitProviderMocks()
    dir = mkdtempSync(join(tmpdir(), 'kept-usage-'))
  })
  afterEach(() => {
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  it('shows the figures read before the restart, dated then, when the first check is throttled', async () => {
    const file = join(dir, 'last-good.json')
    const before = serviceWithAccounts()
    before.setKeptReadings(new KeptUsageReadings(file))
    vi.mocked(fetchInactiveClaudeAccountUsage).mockResolvedValue(okProvider('claude', 58))
    await before.readAccountUsage('claude', 'side')
    before.stop()

    vi.setSystemTime(NOW + 20 * MINUTE)
    const after = serviceWithAccounts()
    const kept = new KeptUsageReadings(file)
    await kept.whenLoaded()
    after.setKeptReadings(kept)
    vi.mocked(fetchInactiveClaudeAccountUsage).mockResolvedValue(throttled(NOW + 25 * MINUTE))

    expect(await after.readAccountUsage('claude', 'side')).toMatchObject({
      status: 'error',
      session: { usedPercent: 58 },
      updatedAt: NOW,
      usageMetadata: { failureKind: 'rate-limited' }
    })
    // Another account has no reading kept: it must not borrow this one's.
    expect(await after.readAccountUsage('claude', 'spare')).toMatchObject({
      status: 'error',
      session: null
    })
  })
})
