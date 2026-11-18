import type {
  SealAccountKey,
  SealAccountsConfig,
  SealProvider,
  SealScopePolicy
} from './seal-accounts-config'
import { parseSealAccountKey, sealAccountKeysMatch } from './seal-account-key'

/** One rule that names an account: as the default, or in its allow-list. */
export type SealAccountTie = {
  scope: 'machine' | 'project'
  /** Machine key, or project match pattern. */
  target: string
  label: string | null
  /** For a project rule scoped to one machine. */
  machine: string | null
  role: 'default' | 'allowed'
}

function roleIn(
  policy: SealScopePolicy | undefined,
  key: SealAccountKey
): SealAccountTie['role'] | null {
  if (policy?.default && sealAccountKeysMatch(policy.default, key)) {
    return 'default'
  }
  return policy?.allow?.some((entry) => sealAccountKeysMatch(entry, key)) ? 'allowed' : null
}

/** The machines and projects whose rules name this account, defaults first. */
export function sealAccountTies(
  config: Pick<SealAccountsConfig, 'machines' | 'projects'>,
  key: SealAccountKey,
  provider: SealProvider | null = parseSealAccountKey(key)?.provider ?? null
): SealAccountTie[] {
  if (!provider) {
    return []
  }
  const ties: SealAccountTie[] = []
  for (const rule of config.machines) {
    const role = roleIn(rule[provider], key)
    if (role) {
      const label = rule.label ?? null
      ties.push({ scope: 'machine', target: rule.machine, label, machine: null, role })
    }
  }
  for (const rule of config.projects) {
    const role = roleIn(rule[provider], key)
    if (role) {
      const machine = rule.machine ?? null
      ties.push({ scope: 'project', target: rule.match, label: rule.label ?? null, machine, role })
    }
  }
  return ties.sort(
    (left, right) => Number(left.role !== 'default') - Number(right.role !== 'default')
  )
}
