import { describe, expect, it } from 'vitest'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import { createHomeChatAccountProvider } from './home-chat-accounts'

function claude(overrides: Partial<SealAccountCandidate>): SealAccountCandidate {
  return {
    key: 'claude:brian@acme.dev',
    provider: 'claude',
    kind: 'oauth',
    localId: 'work',
    email: 'brian@acme.dev',
    label: 'brian@acme.dev',
    plan: null,
    priority: 100,
    disabled: false,
    active: false,
    launchable: true,
    authFailure: false,
    limits: null,
    sessionThreshold: null,
    weeklyThreshold: null,
    ...overrides
  }
}

describe('Home chat account choices', () => {
  it('offers each Seal account once, with the system login under the null id', async () => {
    const provider = createHomeChatAccountProvider({
      sealCandidates: (name) =>
        name === 'codex'
          ? []
          : [
              claude({ label: 'Work', systemLogin: true }),
              claude({
                key: 'claude:brian@example.com',
                localId: 'side',
                email: 'brian@example.com',
                orgName: 'Personal',
                label: 'Side projects'
              }),
              claude({
                key: 'claude:old@acme.dev',
                localId: 'old',
                label: 'old@acme.dev',
                health: { state: 'dead', reason: 'rejected' }
              }),
              claude({ key: 'claude-key:k1', kind: 'api-key', localId: 'k1', label: 'Team key' })
            ],
      listClaudeAccounts: () => {
        throw new Error('listing reads Seal, not the Claude account service')
      },
      listCodexAccounts: () => []
    })

    expect(await provider.list()).toEqual([
      { backend: 'claude-code', id: null, label: 'System login', detail: 'Work' },
      {
        backend: 'claude-code',
        id: 'side',
        label: 'Side projects',
        detail: 'brian@example.com · Personal'
      },
      { backend: 'codex', id: null, label: 'System login' }
    ])
  })
})
