import type {
  SealAccountKey,
  SealAccountsConfig,
  SealMachineRule,
  SealProjectRule,
  SealProvider,
  SealScopePolicy
} from './seal-accounts-config'
import { sealAccountKeysMatch } from './seal-account-key'

/** Every name a launch's project answers to; any of them may match a project rule. */
export type SealProjectIdentity = {
  /** Canonical git remote key, e.g. `github.com/brokespace/seal`. */
  remoteKey?: string | null
  path?: string | null
  displayName?: string | null
  repoId?: string | null
}

export type SealLaunchScope = {
  provider: SealProvider
  machineKey: string
  project: SealProjectIdentity | null
}

export type ResolvedSealPolicy = {
  /** Null allows every account. An empty array allows none (two rules with disjoint lists). */
  allow: SealAccountKey[] | null
  defaultKey: SealAccountKey | null
  defaultSource: 'project' | 'machine' | null
  projectRule: SealProjectRule | null
  machineRule: SealMachineRule | null
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

function trimTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, '')
}

function folderName(path: string): string {
  const trimmed = trimTrailingSeparators(path)
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

export function projectIdentityNames(project: SealProjectIdentity): string[] {
  const names = [
    project.remoteKey,
    project.path ? trimTrailingSeparators(project.path) : null,
    project.path ? folderName(project.path) : null,
    project.displayName,
    project.repoId
  ]
  return names.filter((name): name is string => typeof name === 'string' && name.trim() !== '')
}

export function projectRuleMatches(
  rule: Pick<SealProjectRule, 'match'>,
  project: SealProjectIdentity
): boolean {
  const pattern = trimTrailingSeparators(rule.match.trim())
  if (!pattern) {
    return false
  }
  const matcher = globToRegExp(pattern)
  return projectIdentityNames(project).some((name) => matcher.test(name))
}

export function findProjectRule(
  config: Pick<SealAccountsConfig, 'projects'>,
  project: SealProjectIdentity | null
): SealProjectRule | null {
  if (!project) {
    return null
  }
  // Exact rules win over globs so a catch-all cannot shadow a specific project.
  const matches = config.projects.filter((rule) => projectRuleMatches(rule, project))
  return matches.find((rule) => !rule.match.includes('*')) ?? matches[0] ?? null
}

export function findMachineRule(
  config: Pick<SealAccountsConfig, 'machines'>,
  machineKey: string
): SealMachineRule | null {
  return config.machines.find((rule) => rule.machine === machineKey) ?? null
}

function allowList(policy: SealScopePolicy | undefined): SealAccountKey[] | null {
  return policy?.allow && policy.allow.length > 0 ? policy.allow : null
}

function intersect(left: SealAccountKey[], right: SealAccountKey[]): SealAccountKey[] {
  return left.filter((key) => right.some((other) => sealAccountKeysMatch(key, other)))
}

export function isAllowedByPolicy(
  policy: Pick<ResolvedSealPolicy, 'allow'>,
  key: SealAccountKey
): boolean {
  return policy.allow === null || policy.allow.some((allowed) => sealAccountKeysMatch(allowed, key))
}

/** Project and machine rules both constrain a launch: allow-lists intersect, the project default wins. */
export function resolveSealPolicy(
  config: Pick<SealAccountsConfig, 'projects' | 'machines'>,
  scope: SealLaunchScope
): ResolvedSealPolicy {
  const projectRule = findProjectRule(config, scope.project)
  const machineRule = findMachineRule(config, scope.machineKey)
  const projectPolicy = projectRule?.[scope.provider]
  const machinePolicy = machineRule?.[scope.provider]
  const projectAllow = allowList(projectPolicy)
  const machineAllow = allowList(machinePolicy)
  const allow =
    projectAllow && machineAllow
      ? intersect(projectAllow, machineAllow)
      : (projectAllow ?? machineAllow)
  const resolved = { allow }
  const projectDefault = projectPolicy?.default ?? null
  const machineDefault = machinePolicy?.default ?? null
  if (projectDefault && isAllowedByPolicy(resolved, projectDefault)) {
    return { allow, defaultKey: projectDefault, defaultSource: 'project', projectRule, machineRule }
  }
  if (machineDefault && isAllowedByPolicy(resolved, machineDefault)) {
    return { allow, defaultKey: machineDefault, defaultSource: 'machine', projectRule, machineRule }
  }
  return { allow, defaultKey: null, defaultSource: null, projectRule, machineRule }
}

export function policyConstrainsLaunch(policy: ResolvedSealPolicy): boolean {
  return policy.allow !== null || policy.defaultKey !== null
}
