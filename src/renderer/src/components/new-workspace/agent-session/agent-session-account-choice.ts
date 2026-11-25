import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { parseExecutionHostId } from '../../../../../shared/execution-host'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type {
  SealAccountKey,
  SealProvider
} from '../../../../../shared/seal-accounts/seal-accounts-config'
import type { TuiAgent } from '../../../../../shared/agent-launch/catalog/tui-agent'

/** An account picked for one session, valid only for the agent and machine it was picked on. */
export type AgentSessionAccountChoice = {
  key: SealAccountKey
  provider: SealProvider
  hostId: string
}

export function agentSessionAccountProvider(agent: TuiAgent | null): SealProvider | null {
  return agent === 'claude' || agent === 'codex' ? agent : null
}

/** The runtime that owns a machine's accounts; an SSH-only machine runs no Seal to ask. */
export function agentSessionAccountHost(
  executionHostId: string | null | undefined
): { hostId: string; target: RuntimeClientTarget | null } | null {
  const host = parseExecutionHostId(executionHostId ?? 'local')
  if (!host) {
    return null
  }
  return {
    hostId: host.id,
    target:
      host.kind === 'local'
        ? { kind: 'local' }
        : host.kind === 'runtime'
          ? { kind: 'environment', environmentId: host.environmentId }
          : null
  }
}

/** The choice that still applies to this agent on this machine, else null. */
export function currentAgentSessionAccount(
  choice: AgentSessionAccountChoice | null,
  agent: TuiAgent | null,
  executionHostId: string | null | undefined
): AgentSessionAccountChoice | null {
  return choice &&
    choice.provider === agentSessionAccountProvider(agent) &&
    choice.hostId === agentSessionAccountHost(executionHostId)?.hostId
    ? choice
    : null
}

/** Tells the machine which account the project's next agent launch runs on. */
export async function chooseAgentSessionAccount(
  choice: AgentSessionAccountChoice,
  repoId: string
): Promise<void> {
  const target = agentSessionAccountHost(choice.hostId)?.target
  if (!target) {
    return
  }
  await callRuntimeRpc(
    target,
    'seal.accounts.chooseNextLaunch',
    { repoId, provider: choice.provider, account: choice.key },
    { timeoutMs: 20_000 }
  )
}
