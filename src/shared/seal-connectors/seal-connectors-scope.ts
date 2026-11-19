import { projectRuleMatches, type SealProjectIdentity } from '../seal-accounts/seal-account-policy'
import { sealAccountKeysMatch } from '../seal-accounts/seal-account-key'
import type { AppliesTo, ProjectOverride, SealScope } from './seal-connectors-types'

/** Where a session runs and as whom; every connector, sign-in, plugin and skill is judged on it. */
export type ScopeContext = {
  /** Every key this host answers to, its `host:` key first. */
  machineKeys: readonly string[]
  accountKey: string | null
  harness: string
  project: SealProjectIdentity | null
}

type Scoped = { enabled: boolean; appliesTo: AppliesTo; projectOverrides: ProjectOverride[] }

function scopeHas(scope: SealScope, wanted: readonly string[], same = Object.is): boolean {
  return scope === 'all' || scope.some((entry) => wanted.some((value) => same(entry, value)))
}

/** The most specific override wins: machine-scoped before every-machine, exact before glob. */
function projectOverride(item: Scoped, ctx: ScopeContext): ProjectOverride | null {
  const project = ctx.project
  if (!project) {
    return null
  }
  const rank = (entry: ProjectOverride): number =>
    (entry.machine === undefined ? 2 : 0) + (entry.match.includes('*') ? 1 : 0)
  return item.projectOverrides
    .filter(
      (entry) =>
        (entry.machine === undefined || ctx.machineKeys.includes(entry.machine)) &&
        projectRuleMatches(entry, project)
    )
    .reduce<ProjectOverride | null>(
      (best, entry) => (best === null || rank(entry) < rank(best) ? entry : best),
      null
    )
}

export function scopeIncludes(item: Scoped, ctx: ScopeContext): boolean {
  const override = projectOverride(item, ctx)
  if (override) {
    return override.state === 'on'
  }
  const { machines, accounts, harnesses } = item.appliesTo
  return (
    item.enabled &&
    scopeHas(machines, ctx.machineKeys) &&
    (accounts === 'all' ||
      (ctx.accountKey !== null &&
        scopeHas(accounts, [ctx.accountKey], (a, b) => sealAccountKeysMatch(a, b)))) &&
    scopeHas(harnesses, [ctx.harness])
  )
}

/** Short summary for chips: "All agents", or the restricted dimensions. */
export function appliesToIsAll(appliesTo: AppliesTo): boolean {
  return (
    appliesTo.machines === 'all' && appliesTo.accounts === 'all' && appliesTo.harnesses === 'all'
  )
}
