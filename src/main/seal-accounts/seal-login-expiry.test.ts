import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sealAccountHealth } from '../../shared/seal-accounts/seal-account-health'
import {
  markClaudeRefreshRejected,
  resetClaudeRefreshRejectionsForTest
} from '../claude-accounts/runtime-auth/claude-refresh-rejections'
import { SealLoginExpiryCache } from './seal-login-expiry'

const NOW = 1_800_000_000_000
const KEY = 'claude:a@x.io'
let root: string
let cache: SealLoginExpiryCache

function manager() {
  const candidate = {
    key: KEY,
    provider: 'claude',
    kind: 'oauth',
    launchable: true,
    localId: 'acct'
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the cache reads only these members of the manager
  return {
    baseCandidates: (provider: string) => (provider === 'claude' ? [candidate] : []),
    services: {
      claudeRuntimeAuth: {
        router: {
          accountHome: () => join(root, 'account'),
          systemDefaultHome: () => join(root, 'system')
        }
      }
    },
    codexHome: () => null,
    now: () => NOW
  } as unknown as Parameters<SealLoginExpiryCache['refresh']>[0]
}

function writeHome(options: { login: boolean; refreshToken?: string }): void {
  const dir = join(root, 'account')
  mkdirSync(dir, { recursive: true })
  rmSync(join(dir, '.credentials.json'), { force: true, recursive: true })
  writeFileSync(
    join(dir, '.claude.json'),
    JSON.stringify(options.login ? { oauthAccount: { emailAddress: 'a@x.io' } } : {})
  )
  if (options.refreshToken) {
    writeFileSync(
      join(dir, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'access-old',
          refreshToken: options.refreshToken,
          expiresAt: NOW + 3_600_000
        }
      })
    )
  }
}

async function read() {
  cache.invalidate()
  await cache.refresh(manager())
  return cache.get(KEY)
}

function health(expiry: ReturnType<SealLoginExpiryCache['get']>) {
  return sealAccountHealth({
    now: NOW,
    authFailure: false,
    needsSignIn: false,
    missingSecret: false,
    setupTokenCreatedAt: null,
    expiry
  })
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'seal-login-expiry-')))
  cache = new SealLoginExpiryCache()
})

afterEach(() => {
  resetClaudeRefreshRejectionsForTest()
  rmSync(root, { recursive: true, force: true })
})

describe('SealLoginExpiryCache for Claude', () => {
  it('reports a folder that names a login but holds no token as missing', async () => {
    writeHome({ login: true })
    const expiry = await read()
    expect(expiry).toEqual({ expiresAt: null, refreshable: false, missing: true })
    expect(health(expiry)).toEqual({ state: 'dead', reason: 'signed-out' })
  })

  it('stays silent for a folder that never held a login', async () => {
    writeHome({ login: false })
    expect(await read()).toBeNull()
  })

  it('stays silent when the credentials cannot be read', async () => {
    writeHome({ login: true })
    mkdirSync(join(root, 'account', '.credentials.json'))
    expect(await read()).toBeNull()
  })

  it('calls a stored login dead once its refresh token was refused, until a new login replaces it', async () => {
    writeHome({ login: true, refreshToken: 'refresh-old' })
    expect(health(await read())).toEqual({ state: 'ok' })

    markClaudeRefreshRejected('refresh-old')
    const rejected = await read()
    expect(rejected).toMatchObject({ refreshable: false, refreshRejected: true })
    expect(health(rejected)).toEqual({ state: 'dead', reason: 'expired' })

    writeHome({ login: true, refreshToken: 'refresh-new' })
    const renewed = await read()
    expect(renewed?.refreshRejected).toBeUndefined()
    expect(health(renewed)).toEqual({ state: 'ok' })
  })

  it('treats a refresh token past its own expiry as refused', async () => {
    writeHome({ login: true })
    writeFileSync(
      join(root, 'account', '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'access-old',
          refreshToken: 'refresh-old',
          expiresAt: NOW + 3_600_000,
          refreshTokenExpiresAt: NOW - 1
        }
      })
    )
    expect(await read()).toMatchObject({ refreshable: false, refreshRejected: true })
  })
})
