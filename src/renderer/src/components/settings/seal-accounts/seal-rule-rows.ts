import {
  SEAL_PROVIDERS,
  type SealAccountsConfig,
  type SealProvider,
  type SealScopePolicy
} from '../../../../../shared/seal-accounts/seal-accounts-config'
import {
  projectRuleMatches,
  type SealProjectIdentity
} from '../../../../../shared/seal-accounts/seal-account-policy'
import type { SealFleetMachine } from '../../../../../shared/seal-accounts/seal-fleet-overview'

export type SealRuleRef = {
  scope: 'project' | 'machine'
  target: string
  provider: SealProvider
  /** A project rule for one machine only (a machine rule key). */
  machine?: string
}

export type SealRuleRow = SealRuleRef & { label: string | null; policy: SealScopePolicy }

export type SealRuleDraft = SealRuleRef & {
  label?: string
  allow: string[]
  default: string | null
}

/** Which rules a list shows, and what a rule added from it applies to. */
export type SealRuleScope =
  | { kind: 'machine'; machine: SealFleetMachine }
  | { kind: 'project'; project: SealProjectIdentity; match: string; label: string }

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
          ...(rule.machine ? { machine: rule.machine } : {}),
          label: rule.label ?? null,
          policy
        })
      }
    }
  }
  return rows
}

export function sealRuleRowKey(row: SealRuleRef): string {
  return `${row.scope}:${row.target}:${row.machine ?? ''}:${row.provider}`
}

/** A machine's own rules and the project rules made for it; a project's rules on any machine. */
export function sealRuleInScope(row: SealRuleRow, scope: SealRuleScope): boolean {
  if (scope.kind === 'machine') {
    const keys = scope.machine.ruleKeys
    return row.scope === 'machine'
      ? keys.includes(row.target)
      : row.machine !== undefined && keys.includes(row.machine)
  }
  return row.scope === 'project' && projectRuleMatches({ match: row.target }, scope.project)
}

/** The machine a rule key names, among the machines the page lists. */
export function sealMachineForRuleKey(
  machines: readonly SealFleetMachine[],
  key: string
): SealFleetMachine | null {
  return machines.find((machine) => machine.ruleKeys.includes(key)) ?? null
}
