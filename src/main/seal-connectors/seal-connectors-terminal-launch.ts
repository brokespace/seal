import { randomUUID } from 'node:crypto'
import { withClaudeCommandArgs } from '../../shared/claude-agent-view-launch'
import { withCodexCommandArgs } from '../../shared/agent-launch/startup/tui-agent-launch-command'
import {
  quoteStartupArg,
  type AgentStartupShell
} from '../../shared/agent-launch/startup/tui-agent-startup-shell'
import { quotePowerShellNativeArgument } from '../../shared/powershell-native-argument'
import {
  claudeConnectorArgs,
  codexConnectorArgs,
  type SessionConnectorPlan
} from '../../shared/seal-connectors/session-connector-args'
import { codexConfigServerNames } from './codex-config-server-names'
import { getSealAccountManager } from '../seal-accounts/seal-account-manager'
import { sealProjectIdentity } from '../seal-accounts/seal-launch-pick-context'
import { withSessionMcpConfig } from './seal-connectors-session-config-file'
import { resolveSessionConnectors, resolveTerminalConnectors } from './seal-connectors-session-plan'

async function terminalArgs(
  plan: SessionConnectorPlan,
  agent: 'claude' | 'codex',
  sessionId: string,
  codexHome: string | null | undefined
): Promise<string[]> {
  return agent === 'claude'
    ? withSessionMcpConfig(sessionId, (mcpConfigArgument) =>
        claudeConnectorArgs(plan, { mcpConfigArgument })
      )
    : codexConnectorArgs(plan, await codexConfigServerNames(codexHome))
}

function quoteCodexArg(arg: string, shell: AgentStartupShell): string {
  return shell === 'powershell' ? quotePowerShellNativeArgument(arg) : quoteStartupArg(arg, shell)
}

/**
 * Gives a terminal `claude` or `codex` launch Seal's central connectors: the config rides in the
 * command, the session key only in the environment. Anything it cannot rewrite is left as is.
 */
export async function withSealConnectorsTerminalLaunch(input: {
  agent: string | undefined
  command: string | undefined
  env: Record<string, string> | undefined
  sessionId: string | undefined
  worktreeId: string | undefined
  shell: AgentStartupShell
  codexHome: string | null | undefined
}): Promise<{ command: string | undefined; env: Record<string, string> | undefined }> {
  const { agent, command } = input
  const unchanged = { command, env: input.env }
  // cmd.exe cannot carry Codex's TOML `-c` values intact, so that agent keeps its own config there.
  if (
    command === undefined ||
    (agent !== 'claude' && agent !== 'codex') ||
    (agent === 'codex' && input.shell === 'cmd')
  ) {
    return unchanged
  }
  try {
    const sessionId = input.sessionId ?? randomUUID()
    const plan = await resolveTerminalConnectors({
      sessionId,
      harness: agent,
      env: input.env,
      worktreeId: input.worktreeId
    })
    if (!plan) {
      return unchanged
    }
    const args = await terminalArgs(
      plan,
      agent,
      sessionId,
      input.codexHome ?? input.env?.CODEX_HOME
    )
    const rewritten =
      agent === 'claude'
        ? withClaudeCommandArgs(command, args, input.shell)
        : withCodexCommandArgs(command, args, input.shell, quoteCodexArg)
    return rewritten === command
      ? unchanged
      : { command: rewritten, env: { ...input.env, ...plan.env } }
  } catch (error) {
    console.warn(
      '[seal-connectors] Could not add connectors to a launch:',
      error instanceof Error ? error.name : 'Error'
    )
    return unchanged
  }
}

/**
 * The connector args of a resume line typed into a pane. The key is not minted here: the pane's
 * shell still holds the one its first launch got, rebound to the new plan.
 */
export async function sealConnectorsResumeArgs(input: {
  provider: 'claude' | 'codex'
  sessionId: string
  accountKey: string | null
  worktreeId: string | null
  codexHome: string | null
}): Promise<string[]> {
  const manager = getSealAccountManager()
  const plan = await resolveSessionConnectors({
    sessionId: input.sessionId,
    harness: input.provider,
    accountKey: input.accountKey,
    project: manager ? sealProjectIdentity(manager, input.worktreeId ?? undefined) : null,
    mintKey: false
  })
  if (!plan) {
    return []
  }
  return input.provider === 'claude'
    ? withSessionMcpConfig(input.sessionId, (mcpConfigArgument) =>
        claudeConnectorArgs(plan, { tolerateMissingKey: true, mcpConfigArgument })
      )
    : codexConnectorArgs(plan, await codexConfigServerNames(input.codexHome))
}
