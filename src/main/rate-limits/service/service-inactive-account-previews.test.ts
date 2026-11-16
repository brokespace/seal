import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimitService } from './rate-limit-service'
import { fetchActiveClaudeRateLimits } from '../providers/claude/claude-active-usage-fetch'
import { fetchInactiveClaudeAccountUsage } from '../providers/claude/claude-managed-account-usage'
import { fetchCodexRateLimits } from '../providers/codex/codex-fetcher'
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

vi.mock('../providers/gemini/gemini-usage-fetcher', () => ({
  fetchGeminiRateLimits: vi.fn()
}))

vi.mock('../providers/kimi/kimi-fetcher', () => ({
  fetchKimiRateLimits: vi.fn()
}))

vi.mock('../providers/opencode-go/opencode-go-usage-source-selection', () => ({
  fetchOpenCodeGoUsage: vi.fn()
}))

vi.mock('../providers/zcode/zcode-usage-fetcher', () => ({
  fetchZcodeRateLimits: vi.fn()
}))

vi.mock('../providers/muse/muse-usage-fetcher', () => ({
  fetchMuseRateLimits: vi.fn()
}))

vi.mock('../providers/antigravity/antigravity-usage-fetcher', () => ({
  fetchAntigravityRateLimits: vi.fn()
}))

vi.mock('../providers/minimax/minimax-fetcher', () => ({
  fetchMiniMaxRateLimits: vi.fn()
}))

vi.mock('../providers/grok/grok-fetcher', () => ({
  fetchGrokRateLimits: vi.fn()
}))

vi.mock('../providers/cursor/cursor-fetcher', () => ({
  fetchCursorRateLimits: vi.fn()
}))

vi.mock('../providers/cursor/cursor-auth', () => ({
  readCursorAuthSession: vi.fn()
}))

vi.mock('../providers/grok/grok-auth', () => ({
  readGrokAuthSession: vi.fn(() => ({ status: 'missing' }))
}))

vi.mock('../../minimax/minimax-cookie-store', () => ({
  hasMiniMaxSessionCookie: vi.fn(() => false)
}))

describe('RateLimitService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_700_000_000_000)
    resetRateLimitProviderMocks()
    vi.mocked(fetchActiveClaudeRateLimits).mockResolvedValue(okProvider('claude', 0, 1_000))
    vi.mocked(fetchCodexRateLimits).mockResolvedValue(okProvider('codex', 0, 1_000))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not ask again while a throttled usage check is still told to wait', async () => {
    const service = new RateLimitService()
    service.setInactiveClaudeAccountsResolver(() => [{ id: 'account-1' }])
    vi.mocked(fetchInactiveClaudeAccountUsage).mockResolvedValue({
      provider: 'claude',
      session: null,
      weekly: null,
      updatedAt: 1_700_000_000_000,
      error: 'Claude is throttling usage checks right now.',
      status: 'error',
      usageMetadata: { failureKind: 'rate-limited', retryAtMs: 1_700_000_000_000 + 300_000 }
    })

    await service.readAccountUsage('claude', 'account-1')
    vi.setSystemTime(1_700_000_000_000 + 120_000)
    await service.readAccountUsage('claude', 'account-1')
    expect(fetchInactiveClaudeAccountUsage).toHaveBeenCalledTimes(1)

    vi.setSystemTime(1_700_000_000_000 + 301_000)
    await service.readAccountUsage('claude', 'account-1')
    expect(fetchInactiveClaudeAccountUsage).toHaveBeenCalledTimes(2)
  })

  it("reads the machine's own unselected login from its own home, and never as another login's", async () => {
    const service = new RateLimitService()
    vi.mocked(fetchActiveClaudeRateLimits).mockResolvedValue(okProvider('claude', 61))

    await service.readSystemLoginUsage('claude', 'claude:me@acme.dev')

    expect(
      vi.mocked(fetchActiveClaudeRateLimits).mock.calls.map(([options]) => options?.authPreparation)
    ).toEqual([{ configDir: '/home/me/.claude', envPatch: {}, provenance: 'system' }])
    expect(service.getState().systemLoginUsage).toEqual({
      claude: {
        identity: 'claude:me@acme.dev',
        rateLimits: expect.objectContaining({
          session: expect.objectContaining({ usedPercent: 61 })
        }),
        isFetching: false
      }
    })

    // The machine signs in as someone else: the kept reading is not served for the new login.
    vi.mocked(fetchActiveClaudeRateLimits).mockResolvedValue(okProvider('claude', 7))
    const other = await service.readSystemLoginUsage('claude', 'claude:other@acme.dev')
    expect(other?.session?.usedPercent).toBe(7)
    expect(service.getState().systemLoginUsage?.claude?.identity).toBe('claude:other@acme.dev')
  })
})
