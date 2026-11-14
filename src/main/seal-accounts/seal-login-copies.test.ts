import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../macos-keychain/generic-password', () => ({
  execSecurityCommand: vi.fn(async () => {
    throw Object.assign(new Error('not found'), { code: 44 })
  }),
  isKeychainNotFoundError: () => true,
  readKeychainPassword: vi.fn(async () => null)
}))

const { reconcileClaudeLogin } = await import('./seal-login-copies')

const NOW = 1_800_000_000_000
const HOUR = 3_600_000
let root: string

function creds(token: string, expiresAt: number): string {
  return JSON.stringify({
    claudeAiOauth: { accessToken: `at-${token}`, refreshToken: `rt-${token}`, expiresAt }
  })
}

function home(name: string, email: string, credentials: string | null): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: email } })
  )
  if (credentials) {
    writeFileSync(join(dir, '.credentials.json'), credentials)
  }
  return dir
}

function tokenIn(dir: string): string {
  return JSON.parse(readFileSync(join(dir, '.credentials.json'), 'utf8')).claudeAiOauth.refreshToken
}

function manager(sessionHomes: string[]) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: reconcile reads only these members of the manager
  return {
    services: { claudeRuntimeAuth: { router: { accountHome: () => join(root, 'account') } } },
    store: {
      getState: () => ({
        sessions: sessionHomes.map((profileHome) => ({
          provider: 'claude',
          accountKey: 'claude:a@x.io',
          profileHome
        })),
        fleetCopies: {}
      })
    },
    codexHome: () => null,
    now: () => NOW,
    machineKey: 'local'
  } as unknown as Parameters<typeof reconcileClaudeLogin>[0]
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'seal-login-copies-')))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('reconcileClaudeLogin', () => {
  it('saves a session’s refreshed token back to the account, never another login’s', async () => {
    home('account', 'a@x.io', creds('old', NOW + 2 * HOUR))
    const session = home('session', 'a@x.io', creds('rotated', NOW + 8 * HOUR))
    const relogged = home('relogged', 'b@x.io', creds('other', NOW + 9 * HOUR))
    const result = await reconcileClaudeLogin(manager([session, relogged]), {
      accountId: 'acct',
      accountKey: 'claude:a@x.io',
      fetch: async () => {
        throw new Error('no refresh expected')
      }
    })
    expect(result).toEqual({ freshness: NOW + 8 * HOUR, refreshed: false, updated: 1 })
    expect(tokenIn(join(root, 'account'))).toBe('rt-rotated')
    expect(tokenIn(relogged)).toBe('rt-other')
  })

  it('refreshes a shared login near expiry once and gives every copy the successor', async () => {
    home('account', 'a@x.io', creds('one', NOW + 10 * 60_000))
    const session = home('session', 'a@x.io', creds('one', NOW + 10 * 60_000))
    const posted: unknown[] = []
    const result = await reconcileClaudeLogin(manager([session]), {
      accountId: 'acct',
      accountKey: 'claude:a@x.io',
      fetch: async (_url, init) => {
        posted.push(JSON.parse(String(init?.body)).refresh_token)
        return new Response(
          JSON.stringify({ access_token: 'at-two', refresh_token: 'rt-two', expires_in: 3600 })
        )
      }
    })
    expect(posted).toEqual(['rt-one'])
    expect(result).toEqual({ freshness: NOW + HOUR, refreshed: true, updated: 2 })
    expect([tokenIn(join(root, 'account')), tokenIn(session)]).toEqual(['rt-two', 'rt-two'])
  })
})
