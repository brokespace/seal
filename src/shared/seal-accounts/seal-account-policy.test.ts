import { describe, expect, it } from 'vitest'
import { resolveSealPolicy } from './seal-account-policy'
import { defaultSealAccountsConfig, type SealAccountsConfig } from './seal-accounts-config'
import { sealAccountKeysMatch } from './seal-account-key'

function config(partial: Partial<SealAccountsConfig>): SealAccountsConfig {
  return { ...defaultSealAccountsConfig(), ...partial }
}

const sealRepo = { remoteKey: 'github.com/brokespace/seal', path: '/Users/b/src/seal' }

describe('resolveSealPolicy', () => {
  it('prefers an exact project rule over a glob that also matches', () => {
    const resolved = resolveSealPolicy(
      config({
        projects: [
          { match: 'github.com/brokespace/*', claude: { default: 'claude:org@corp.com' } },
          { match: 'seal', claude: { default: 'claude:me@home.com' } }
        ]
      }),
      { provider: 'claude', machineKeys: ['local'], project: sealRepo }
    )
    expect(resolved.defaultKey).toBe('claude:me@home.com')
    expect(resolved.defaultSource).toBe('project')
  })

  it('intersects project and machine allow-lists', () => {
    const resolved = resolveSealPolicy(
      config({
        projects: [
          {
            match: 'github.com/brokespace/seal',
            codex: { allow: ['codex:a@x.com', 'codex:b@x.com'] }
          }
        ],
        machines: [{ machine: 'runtime:box', codex: { allow: ['codex:b@x.com', 'codex:c@x.com'] } }]
      }),
      { provider: 'codex', machineKeys: ['runtime:box'], project: sealRepo }
    )
    expect(resolved.allow).toEqual(['codex:b@x.com'])
  })

  it('drops a project default the machine does not allow and uses the machine default', () => {
    const resolved = resolveSealPolicy(
      config({
        projects: [{ match: '/Users/b/src/seal', claude: { default: 'claude:a@x.com' } }],
        machines: [
          { machine: 'local', claude: { allow: ['claude:b@x.com'], default: 'claude:b@x.com' } }
        ]
      }),
      { provider: 'claude', machineKeys: ['local'], project: sealRepo }
    )
    expect(resolved).toMatchObject({ defaultKey: 'claude:b@x.com', defaultSource: 'machine' })
  })

  it('lets a project rule for one machine override the project rule for every machine there only', () => {
    const rules = config({
      projects: [
        { match: 'github.com/brokespace/seal', claude: { default: 'claude:me@home.com' } },
        {
          match: 'github.com/brokespace/seal',
          machine: 'host:quant',
          claude: { default: 'claude:me@corp.com#team' }
        }
      ]
    })
    const on = (machineKeys: string[]) =>
      resolveSealPolicy(rules, { provider: 'claude', machineKeys, project: sealRepo }).defaultKey
    expect(on(['host:quant', 'runtime:legacy'])).toBe('claude:me@corp.com#team')
    expect(on(['host:laptop'])).toBe('claude:me@home.com')
  })

  it('applies no constraint to an unmatched project on an unlisted machine', () => {
    const resolved = resolveSealPolicy(
      config({ projects: [{ match: 'other-repo', claude: { allow: ['claude:a@x.com'] } }] }),
      { provider: 'claude', machineKeys: ['ssh:box'], project: sealRepo }
    )
    expect(resolved).toMatchObject({ allow: null, defaultKey: null, projectRule: null })
  })
})

describe('sealAccountKeysMatch', () => {
  it('matches a key saved before the org was known, but not a different org', () => {
    expect(sealAccountKeysMatch('claude:me@x.com', 'claude:ME@x.com#org-1')).toBe(true)
    expect(sealAccountKeysMatch('claude:me@x.com#org-2', 'claude:me@x.com#org-1')).toBe(false)
    expect(sealAccountKeysMatch('codex:me@x.com', 'claude:me@x.com')).toBe(false)
  })
})
