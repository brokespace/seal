import { describe, expect, it } from 'vitest'
import { defaultSealAccountsConfig } from './seal-accounts-config'
import { withPolicyEdit, withoutApiKey, withProfile } from './seal-accounts-config-edits'

describe('seal account config edits', () => {
  it('edits a project rule in place so glob order is kept', () => {
    const config = {
      ...defaultSealAccountsConfig(),
      projects: [
        { match: 'github.com/acme/*', claude: { allow: ['claude:a@acme.com'] } },
        { match: '*', claude: { default: 'claude:me@home.com' } }
      ]
    }
    const next = withPolicyEdit(config, {
      scope: 'project',
      target: 'github.com/acme/*',
      provider: 'claude',
      default: 'claude:a@acme.com'
    })
    expect(next.projects).toEqual([
      {
        match: 'github.com/acme/*',
        claude: { allow: ['claude:a@acme.com'], default: 'claude:a@acme.com' }
      },
      { match: '*', claude: { default: 'claude:me@home.com' } }
    ])
  })

  it('adds and removes a machine rule', () => {
    const added = withPolicyEdit(defaultSealAccountsConfig(), {
      scope: 'machine',
      target: 'runtime:gpu-box',
      provider: 'codex',
      label: 'GPU box',
      allow: ['codex:ci@corp.com']
    })
    expect(added.machines).toEqual([
      { machine: 'runtime:gpu-box', label: 'GPU box', codex: { allow: ['codex:ci@corp.com'] } }
    ])
    const removed = withPolicyEdit(added, {
      scope: 'machine',
      target: 'runtime:gpu-box',
      provider: 'codex',
      remove: true
    })
    expect(removed.machines).toEqual([])
  })

  it('replaces a profile saved under the org-less key', () => {
    const config = withProfile(defaultSealAccountsConfig(), 'claude:me@x.com', {
      alias: 'old',
      priority: 100
    })
    const next = withProfile(config, 'claude:me@x.com#org-1', { alias: 'work', priority: 10 })
    expect(next.profiles).toEqual({ 'claude:me@x.com#org-1': { alias: 'work', priority: 10 } })
  })

  it('drops the profile of a removed API key', () => {
    const config = {
      ...defaultSealAccountsConfig(),
      apiKeys: [
        { id: 'k1', provider: 'codex' as const, label: 'CI', keyHint: '…abcd', createdAt: 1 }
      ],
      profiles: { 'codex-key:k1': { alias: 'CI key', priority: 5 } }
    }
    const next = withoutApiKey(config, 'k1')
    expect(next.apiKeys).toEqual([])
    expect(next.profiles).toEqual({})
  })
})
