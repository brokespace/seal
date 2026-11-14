import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import type { SealSystemIdentity } from '../../shared/seal-accounts/seal-system-login-candidate'

const machine: Record<SealProvider, SealSystemIdentity | null> = { claude: null, codex: null }
const logOut = vi.fn(async (_services: unknown, provider: SealProvider) => {
  machine[provider] = null
})

vi.mock('./seal-system-login', () => ({
  readSealSystemLogins: () => ({ ...machine }),
  refreshSealSystemLogins: async () => {},
  logOutSealSystemLogin: logOut
}))

const { SealAccountManager } = await import('./seal-account-manager')
const { removeSealAccount } = await import('./seal-account-removal')
const { restoreSealSystemLogin } = await import('./seal-system-login-listing')

type Saved = { id: string; email: string; org?: string }

let root: string
let saved: Record<SealProvider, Saved[]>
let selected: Record<SealProvider, string | null>
const managers: InstanceType<typeof SealAccountManager>[] = []

function accountService(provider: SealProvider) {
  return {
    listAccounts: () => ({
      accounts: saved[provider].map((account) => ({
        id: account.id,
        email: account.email,
        authMethod: 'subscription-oauth',
        organizationUuid: account.org ?? null,
        workspaceAccountId: account.org ?? null,
        createdAt: 1,
        updatedAt: 1,
        lastAuthenticatedAt: 1
      })),
      activeAccountId: selected[provider]
    }),
    removeAccount: async (id: string) => {
      saved[provider] = saved[provider].filter((account) => account.id !== id)
      if (selected[provider] === id) {
        selected[provider] = null
      }
    },
    selectAccount: async (id: string | null) => {
      selected[provider] = id
    }
  }
}

/** A fresh manager over the same data folder: what the next app start sees. */
function startManager() {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: removal and listing read only these members of the services
  const deps = {
    store: { getRepo: () => undefined, getSettings: () => ({ codexManagedAccounts: [] }) },
    services: {
      claudeAccounts: accountService('claude'),
      codexAccounts: accountService('codex'),
      rateLimits: { getState: () => null, onStateChange: () => () => {} }
    },
    dataRoot: root,
    now: () => 1_800_000_000_000,
    fetchUsage: async () => {
      throw new Error('no usage in this test')
    }
  } as unknown as ConstructorParameters<typeof SealAccountManager>[0]
  const manager = new SealAccountManager(deps)
  managers.push(manager)
  return manager
}

function listed(manager: InstanceType<typeof SealAccountManager>, provider: SealProvider) {
  return manager.candidates(provider).map((candidate) => ({
    key: candidate.key,
    kind: candidate.kind,
    systemLogin: candidate.systemLogin,
    active: candidate.active
  }))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'seal-account-removal-'))
  saved = { claude: [], codex: [] }
  selected = { claude: null, codex: null }
  machine.claude = null
  machine.codex = null
  logOut.mockClear()
})

afterEach(() => {
  managers.splice(0).forEach((manager) => manager.dispose())
  rmSync(root, { recursive: true, force: true })
})

describe.each(['claude', 'codex'] as const)('removing the %s system login', (provider) => {
  const key = `${provider}:brian@x.io#org-1`

  beforeEach(() => {
    machine[provider] = { email: 'brian@x.io', scope: 'org-1', orgName: 'Acme' }
  })

  it('lists it as an ordinary removable account tagged as the system login', () => {
    expect(listed(startManager(), provider)).toEqual([
      { key, kind: 'system', systemLogin: true, active: true }
    ])
  })

  it('stays removed across scans and restarts without signing the machine out', async () => {
    const manager = startManager()
    const result = await removeSealAccount(manager, 'brian@x.io', { provider })
    expect(result).toMatchObject({ removed: key, loggedOut: false })
    expect(logOut).not.toHaveBeenCalled()
    expect(machine[provider]).not.toBeNull()
    expect(listed(manager, provider)).toEqual([])
    expect(listed(manager, provider)).toEqual([])

    const restarted = startManager()
    expect(listed(restarted, provider)).toEqual([])
    expect(restarted.status().systemLogins?.[provider]).toEqual({
      key,
      email: 'brian@x.io',
      orgName: 'Acme',
      state: 'dismissed'
    })
  })

  it('comes back only when it is imported again', async () => {
    await removeSealAccount(startManager(), key, { provider })
    const restarted = startManager()
    restoreSealSystemLogin(restarted, provider)
    expect(listed(restarted, provider)).toEqual([
      { key, kind: 'system', systemLogin: true, active: true }
    ])
    expect(listed(startManager(), provider)).toEqual([
      { key, kind: 'system', systemLogin: true, active: true }
    ])
  })

  it('signs the machine out too when asked, and lists a later sign-in to another account', async () => {
    const manager = startManager()
    const result = await removeSealAccount(manager, key, { provider, logout: true })
    expect(result).toMatchObject({ removed: key, loggedOut: true, logoutError: null })
    expect(logOut).toHaveBeenCalledExactlyOnceWith(manager.services, provider)
    expect(listed(manager, provider)).toEqual([])

    machine[provider] = { email: 'sam@x.io', scope: null, orgName: null }
    expect(listed(startManager(), provider)).toEqual([
      { key: `${provider}:sam@x.io`, kind: 'system', systemLogin: true, active: true }
    ])
  })

  it('removes its saved copy as well, so the system row does not replace it', async () => {
    saved[provider] = [
      { id: 'copy', email: 'brian@x.io', org: 'org-1' },
      { id: 'other', email: 'sam@x.io' }
    ]
    selected[provider] = 'copy'
    const manager = startManager()
    expect(listed(manager, provider)).toEqual([
      { key, kind: 'oauth', systemLogin: true, active: true },
      { key: `${provider}:sam@x.io`, kind: 'oauth', systemLogin: false, active: false }
    ])

    const result = await removeSealAccount(manager, key, { provider })
    expect(result.nowUsing).toBe('sam@x.io')
    const remaining = [
      { key: `${provider}:sam@x.io`, kind: 'oauth', systemLogin: false, active: true }
    ]
    expect(listed(manager, provider)).toEqual(remaining)
    expect(listed(startManager(), provider)).toEqual(remaining)
  })
})

describe('removing a saved account', () => {
  it('drops its profile and rules and leaves the other provider alone', async () => {
    saved.claude = [
      { id: 'a', email: 'a@x.io' },
      { id: 'b', email: 'b@x.io' }
    ]
    saved.codex = [{ id: 'c', email: 'a@x.io' }]
    selected.claude = 'b'
    const manager = startManager()
    manager.saveConfig({
      ...manager.getConfig(),
      profiles: { 'claude:a@x.io': { alias: 'Work', priority: 10 } },
      machines: [{ machine: 'local', claude: { allow: ['claude:a@x.io', 'claude:b@x.io'] } }]
    })

    await removeSealAccount(manager, 'Work')

    expect(saved.claude.map((account) => account.id)).toEqual(['b'])
    expect(saved.codex.map((account) => account.id)).toEqual(['c'])
    expect(manager.getConfig().profiles).toEqual({})
    expect(manager.getConfig().machines).toEqual([
      { machine: 'local', claude: { allow: ['claude:b@x.io'] } }
    ])
    expect(manager.store.getState().dismissedSystemLogins).toEqual([])
  })
})
