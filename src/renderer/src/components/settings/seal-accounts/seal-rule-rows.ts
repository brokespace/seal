import {
  SEAL_PROVIDERS,
  type SealAccountsConfig,
  type SealProvider,
  type SealScopePolicy
} from '../../../../../shared/seal-accounts/seal-accounts-config'

export type SealRuleRef = {
  scope: 'project' | 'machine'
  target: string
  provider: SealProvider
}

export type SealRuleRow = SealRuleRef & { label: string | null; policy: SealScopePolicy }

export type SealRuleDraft = SealRuleRef & {
  label?: string
  allow: string[]
  default: string | null
}

/** One row per (rule, provider); machine rules first because project rules narrow them. */
export function sealRuleRows(config: SealAccountsConfig): SealRuleRow[] {
  const rows: SealRuleRow[] = []
  for (const rule of config.machines) {
    for (const provider of SEAL_PROVIDERS) {
      const policy = rule[provider]
      if (policy) {
        rows.push({
          scope: 'machine',
          target: rule.machine,
          provider,
          label: rule.label ?? null,
          policy
        })
      }
    }
  }
  for (const rule of config.projects) {
    for (const provider of SEAL_PROVIDERS) {
      const policy = rule[provider]
      if (policy) {
        rows.push({
          scope: 'project',
          target: rule.match,
          provider,
          label: rule.label ?? null,
          policy
        })
      }
    }
  }
  return rows
}

/** The machine key rules use for a machine the page lists. */
export function sealMachineRuleKey(
  machine: { id: string; home: boolean },
  homeKey: string
): string {
  return machine.home ? homeKey : `runtime:${machine.id}`
}
