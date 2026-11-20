import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isClaudeRefreshRejected,
  resetClaudeRefreshRejectionsForTest
} from '../claude-accounts/runtime-auth/claude-refresh-rejections'
import { reportSealClaudeLoginFailure } from './seal-login-failure'

const NOW = 1_800_000_000_000
let root: string

function systemLogin(expiresAt: number): void {
  mkdirSync(join(root, 'system'), { recursive: true })
  writeFileSync(
    join(root, 'system', '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: { accessToken: 'access-old', refreshToken: 'refresh-old', expiresAt }
    })
  )
}

function manager() {
  const recheckLogins = vi.fn()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the report reads only these members of the manager
  const fake = {
    recheckLogins,
    now: () => NOW,
    baseCandidates: () => [
      { key: 'claude:system', provider: 'claude', kind: 'oauth', localId: null }
    ],
    services: {
      claudeRuntimeAuth: {
        router: {
          accountHome: () => join(root, 'account'),
          systemDefaultHome: () => join(root, 'system')
        }
      }
    }
  } as unknown as NonNullable<Parameters<typeof reportSealClaudeLoginFailure>[1]>
  return { fake, recheckLogins }
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'seal-login-failure-')))
})

afterEach(() => {
  resetClaudeRefreshRejectionsForTest()
  rmSync(root, { recursive: true, force: true })
})

describe('reportSealClaudeLoginFailure', () => {
  it('marks the system login refused when Claude says its session could not be refreshed', async () => {
    systemLogin(NOW - 60_000)
    const { fake, recheckLogins } = manager()
    await reportSealClaudeLoginFailure(
      {
        claudeConfigDir: join(root, 'system'),
        text: 'OAuth session expired and could not be refreshed'
      },
      fake
    )
    expect(recheckLogins).toHaveBeenCalledTimes(1)
    expect(isClaudeRefreshRejected('refresh-old')).toBe(true)
  })

  it('only re-reads login health for an unrelated sign-in failure', async () => {
    systemLogin(NOW - 60_000)
    const { fake, recheckLogins } = manager()
    await reportSealClaudeLoginFailure(
      { claudeConfigDir: join(root, 'system'), text: 'Not logged in · Please run /login' },
      fake
    )
    expect(recheckLogins).toHaveBeenCalledTimes(1)
    expect(isClaudeRefreshRejected('refresh-old')).toBe(false)
  })

  it('does not condemn a login whose access token is still good', async () => {
    systemLogin(NOW + 8 * 3_600_000)
    const { fake } = manager()
    await reportSealClaudeLoginFailure(
      {
        claudeConfigDir: join(root, 'system'),
        text: 'OAuth session expired and could not be refreshed'
      },
      fake
    )
    expect(isClaudeRefreshRejected('refresh-old')).toBe(false)
  })
})
