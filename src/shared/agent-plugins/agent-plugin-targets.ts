import { isAgentConfigAgentId } from '../agent-config/agent-config-catalog'
import type { AgentConfigAgentId } from '../agent-config/agent-config-types'
import { isPlainObject, stringList } from '../agent-config/agent-config-values'
import { parseMachineId, type MachineId } from '../machines/machine-types'
import { sealAccountKeysMatch } from '../seal-accounts/seal-account-key'
import {
  AGENT_PLUGIN_ALL_TARGETS,
  agentPluginSystemAccount,
  type AgentPluginHarness,
  type AgentPluginTargetList,
  type AgentPluginTargets
} from './agent-plugin-types'

function listOf<T extends string>(
  value: unknown,
  accept: (item: string) => item is T
): AgentPluginTargetList<T> {
  return value === 'all' || !Array.isArray(value) ? 'all' : stringList(value).filter(accept)
}

const anyString = (item: string): item is string => item !== ''

export function parseAgentPluginTargets(value: unknown): AgentPluginTargets {
  if (!isPlainObject(value)) {
    return AGENT_PLUGIN_ALL_TARGETS
  }
  return {
    machines: listOf(value.machines, (item): item is MachineId => parseMachineId(item) !== null),
    accounts: listOf(value.accounts, anyString),
    agents: listOf(value.agents, (item): item is AgentConfigAgentId => isAgentConfigAgentId(item))
  }
}

export function targetsInclude<T extends string>(
  list: AgentPluginTargetList<T>,
  value: T
): boolean {
  return list === 'all' || list.includes(value)
}

/** Whether an account takes the plugin; keys saved before a login named its org still match. */
export function targetsIncludeAccount(targets: AgentPluginTargets, key: string): boolean {
  return (
    targets.accounts === 'all' ||
    targets.accounts.some((candidate) => sealAccountKeysMatch(candidate, key))
  )
}

/** The agent's own login on a machine: the home folder every account profile is copied from. */
export function targetsIncludeSystemAccount(
  targets: AgentPluginTargets,
  provider: AgentPluginHarness
): boolean {
  return targetsIncludeAccount(targets, agentPluginSystemAccount(provider))
}
