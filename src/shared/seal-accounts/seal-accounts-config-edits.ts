import type {
  SealAccountKey,
  SealAccountProfile,
  SealAccountsConfig,
  SealApiKeyAccount,
  SealAutoSwapSettings,
  SealProvider,
  SealScopePolicy
} from './seal-accounts-config'
import { apiKeyAccountKey, sealAccountKeysMatch } from './seal-account-key'
import type { SealWorkspacePins } from './seal-accounts-status'

/** One project or machine rule change, with account refs already resolved to keys. */
export type SealPolicyEdit = {
  scope: 'project' | 'machine'
  /** Project match pattern, or machine key. */
  target: string
  /** A project rule for one machine only; absent is the project's rule on every machine. */
  machine?: string
  provider: SealProvider
  label?: string
  allow?: SealAccountKey[]
  default?: SealAccountKey | null
  remove?: boolean
}

/** Keeps rule order, since the first matching glob wins. */
function replaceRule<T>(rules: readonly T[], index: number, next: T | null): T[] {
  if (index === -1) {
    return next ? [...rules, next] : [...rules]
  }
  return next
    ? rules.map((rule, i) => (i === index ? next : rule))
    : rules.filter((_, i) => i !== index)
}

export function withPolicyEdit(
  config: SealAccountsConfig,
  edit: SealPolicyEdit
): SealAccountsConfig {
  const patch = (current: SealScopePolicy | undefined): SealScopePolicy => ({
    ...current,
    ...(edit.allow !== undefined ? { allow: edit.allow } : {}),
    ...(edit.default !== undefined ? { default: edit.default } : {})
  })
  const label = edit.label !== undefined ? { label: edit.label } : {}
  if (edit.scope === 'project') {
    const index = config.projects.findIndex(
      (rule) => rule.match === edit.target && rule.machine === edit.machine
    )
    const rule =
      config.projects[index] ??
      (edit.machine ? { match: edit.target, machine: edit.machine } : { match: edit.target })
    const next = { ...rule, ...label, [edit.provider]: patch(rule[edit.provider]) }
    return { ...config, projects: replaceRule(config.projects, index, edit.remove ? null : next) }
  }
  const index = config.machines.findIndex((rule) => rule.machine === edit.target)
  const rule = config.machines[index] ?? { machine: edit.target }
  const next = { ...rule, ...label, [edit.provider]: patch(rule[edit.provider]) }
  return { ...config, machines: replaceRule(config.machines, index, edit.remove ? null : next) }
}

export function withProfile(
  config: SealAccountsConfig,
  key: SealAccountKey,
  profile: SealAccountProfile | null
): SealAccountsConfig {
  const profiles = Object.fromEntries(
    Object.entries(config.profiles).filter(([saved]) => !sealAccountKeysMatch(saved, key))
  )
  return { ...config, profiles: profile ? { ...profiles, [key]: profile } : profiles }
}

export function withAutoSwap(
  config: SealAccountsConfig,
  provider: SealProvider,
  settings: Partial<SealAutoSwapSettings>
): SealAccountsConfig {
  return {
    ...config,
    autoSwap: { ...config.autoSwap, [provider]: { ...config.autoSwap[provider], ...settings } }
  }
}

export function withApiKey(
  config: SealAccountsConfig,
  entry: SealApiKeyAccount
): SealAccountsConfig {
  return { ...config, apiKeys: [...config.apiKeys, entry] }
}

export function withoutApiKey(config: SealAccountsConfig, id: string): SealAccountsConfig {
  const removed = config.apiKeys.find((entry) => entry.id === id)
  const profiles = { ...config.profiles }
  if (removed) {
    delete profiles[apiKeyAccountKey(removed.provider, id)]
  }
  return { ...config, apiKeys: config.apiKeys.filter((entry) => entry.id !== id), profiles }
}

export function withWorkspacePin(
  pins: SealWorkspacePins,
  worktreeId: string,
  provider: SealProvider,
  key: SealAccountKey | null
): SealWorkspacePins {
  const workspace = { ...pins[worktreeId] }
  if (key) {
    workspace[provider] = key
  } else {
    delete workspace[provider]
  }
  const next = { ...pins }
  if (Object.keys(workspace).length === 0) {
    delete next[worktreeId]
  } else {
    next[worktreeId] = workspace
  }
  return next
}

function withoutKey(policy: SealScopePolicy | undefined, key: SealAccountKey) {
  if (!policy) {
    return undefined
  }
  const matches = (saved: SealAccountKey): boolean => sealAccountKeysMatch(saved, key)
  return {
    ...policy,
    ...(policy.allow ? { allow: policy.allow.filter((saved) => !matches(saved)) } : {}),
    ...(policy.default && matches(policy.default) ? { default: null } : {})
  }
}

/** Drops a removed account from its profile and from every rule that named it. */
export function withoutAccountReferences(
  config: SealAccountsConfig,
  key: SealAccountKey
): SealAccountsConfig {
  const strip = <T extends { claude?: SealScopePolicy; codex?: SealScopePolicy }>(rule: T): T => ({
    ...rule,
    ...(rule.claude ? { claude: withoutKey(rule.claude, key) } : {}),
    ...(rule.codex ? { codex: withoutKey(rule.codex, key) } : {})
  })
  return {
    ...withProfile(config, key, null),
    projects: config.projects.map(strip),
    machines: config.machines.map(strip)
  }
}

const PRIORITY_STEP = 10

/** Priorities follow the given order (first is preferred); other profile fields are kept. */
export function withAccountOrder(
  config: SealAccountsConfig,
  keys: readonly SealAccountKey[]
): SealAccountsConfig {
  return keys.reduce((next, key, index) => {
    const saved = Object.entries(next.profiles).find(([entry]) => sealAccountKeysMatch(entry, key))
    return withProfile(next, key, { ...saved?.[1], priority: (index + 1) * PRIORITY_STEP })
  }, config)
}

/** Moves rules saved under old machine keys to new ones; the same object when nothing moved. */
export function withMachineKeysRenamed(
  config: SealAccountsConfig,
  renames: ReadonlyMap<string, string>
): SealAccountsConfig {
  const renamed = (key: string): string => renames.get(key) ?? key
  const taken = new Set(config.machines.map((rule) => rule.machine))
  // A rule already saved under the new key wins over the old one.
  const machines = config.machines.flatMap((rule) => {
    const next = renamed(rule.machine)
    if (next === rule.machine) {
      return [rule]
    }
    return taken.has(next) ? [] : [{ ...rule, machine: next }]
  })
  const projects = config.projects.map((rule) =>
    rule.machine && renamed(rule.machine) !== rule.machine
      ? { ...rule, machine: renamed(rule.machine) }
      : rule
  )
  const changed =
    machines.length !== config.machines.length ||
    machines.some((rule, index) => rule !== config.machines[index]) ||
    projects.some((rule, index) => rule !== config.projects[index])
  return changed ? { ...config, machines, projects } : config
}
