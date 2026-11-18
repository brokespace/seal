import { describe, expect, it } from 'vitest'
import {
  defaultSealAccountsConfig,
  type SealAccountsConfig
} from '../../shared/seal-accounts/seal-accounts-config'
import { replicateSealConfig } from './seal-config-replication'

/** A Seal host as `seal.accounts.applyFleetConfig` treats it: the newer config wins. */
function host(hostKey: string, config: SealAccountsConfig) {
  let held = config
  return {
    get config() {
      return held
    },
    apply(offered: SealAccountsConfig) {
      if (offered.updatedAt > held.updatedAt) {
        held = offered
      }
      return { applied: true, config: held, hostKey }
    }
  }
}

function desktop(config: SealAccountsConfig, now: number) {
  let held = config
  return {
    host: { hostKey: 'host:desktop', onConfigSaved: () => () => {} },
    getConfig: () => held,
    saveConfig: (next: SealAccountsConfig) => {
      held = { ...next, updatedAt: now }
    },
    applyFleetConfig: (next: SealAccountsConfig) => {
      if (next.updatedAt > held.updatedAt) {
        held = next
      }
      return { applied: true, config: held, hostKey: 'host:desktop' }
    }
  }
}

describe('replicateSealConfig', () => {
  it('adopts an edit made on one host and carries it to the hosts that missed it', async () => {
    const edited: SealAccountsConfig = {
      ...defaultSealAccountsConfig(),
      machines: [{ machine: 'host:quant', claude: { default: 'claude:me@corp.com#team' } }],
      updatedAt: 200
    }
    const quant = host('host:quant', edited)
    const dev = host('host:dev', { ...defaultSealAccountsConfig(), updatedAt: 100 })
    const manager = desktop({ ...defaultSealAccountsConfig(), updatedAt: 150 }, 300)
    const hosts = { quant, dev }
    await replicateSealConfig(
      manager,
      [
        { target: 'quant', environmentId: 'quant' },
        { target: 'dev', environmentId: 'dev' }
      ],
      async (target, _method, params) =>
        hosts[target as keyof typeof hosts].apply((params as { config: SealAccountsConfig }).config)
    )
    expect(manager.getConfig().machines).toEqual(edited.machines)
    expect(dev.config.machines).toEqual(edited.machines)
  })

  it('moves rules saved under this desktop’s server ids to the hosts’ own keys', async () => {
    const legacy: SealAccountsConfig = {
      ...defaultSealAccountsConfig(),
      machines: [{ machine: 'runtime:env-1', codex: { default: 'codex:me@home.com' } }],
      projects: [{ match: 'seal', machine: 'local', claude: { default: 'claude:me@home.com' } }],
      updatedAt: 100
    }
    const manager = desktop(legacy, 500)
    const remote = host('host:remote', { ...defaultSealAccountsConfig(), updatedAt: 0 })
    await replicateSealConfig(
      manager,
      [{ target: 'env-1', environmentId: 'env-1' }],
      async (_target, _method, params) =>
        remote.apply((params as { config: SealAccountsConfig }).config)
    )
    expect(manager.getConfig().machines.map((rule) => rule.machine)).toEqual(['host:remote'])
    expect(manager.getConfig().projects[0]?.machine).toBe('host:desktop')
  })
})
