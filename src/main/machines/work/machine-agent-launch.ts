import { isTuiAgent } from '../../../shared/agent-launch/catalog/tui-agent-config'
import { buildAgentStartupPlan } from '../../../shared/agent-launch/startup/tui-agent-startup'
import type { MachineConnection, MachineShellDialect } from '../connection/machine-connection'
import { quoteForMachineShell } from './machine-worktrees'

export type MachineAgentCommand = { command: string; followupPrompt: string | null }

/** The same startup plan local panes use, rendered for the machine's own shell. */
export function buildMachineAgentCommand(
  agent: string,
  prompt: string,
  dialect: MachineShellDialect
): MachineAgentCommand {
  if (!isTuiAgent(agent)) {
    throw new Error(`Unknown agent "${agent}"`)
  }
  const plan = buildAgentStartupPlan({
    agent,
    prompt,
    cmdOverrides: {},
    platform: dialect === 'powershell' ? 'win32' : 'linux',
    shell: dialect,
    allowEmptyPromptLaunch: true,
    isRemote: true,
    suppressStartupUpdatePrompt: true
  })
  if (!plan) {
    throw new Error(`Seal cannot start ${agent} on this machine`)
  }
  const env = Object.entries(plan.env ?? {})
  const command =
    env.length === 0
      ? plan.launchCommand
      : dialect === 'powershell'
        ? `${env.map(([key, value]) => `$env:${key}=${quoteForMachineShell(value, dialect)}`).join('; ')}; ${plan.launchCommand}`
        : `env ${env.map(([key, value]) => `${key}=${quoteForMachineShell(value, dialect)}`).join(' ')} ${plan.launchCommand}`
  return { command, followupPrompt: plan.followupPrompt ?? plan.draftPrompt ?? null }
}

const COMMAND_NAME = /^[A-Za-z0-9._-]{1,64}$/

/** Which of these CLIs are on the machine's PATH, asked through its own connection. */
export async function detectMachineCommands(
  connection: MachineConnection,
  commands: readonly string[]
): Promise<string[]> {
  const names = [...new Set(commands)].filter((name) => COMMAND_NAME.test(name))
  if (names.length === 0) {
    return []
  }
  const dialect = await connection.dialect()
  const script =
    dialect === 'powershell'
      ? `foreach ($c in @(${names.map((name) => `'${name}'`).join(',')})) { if (Get-Command $c -ErrorAction SilentlyContinue) { $c } }`
      : `for c in ${names.join(' ')}; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done; true`
  const result = await connection.exec(script, { timeoutMs: 20_000 })
  const found = new Set(result.stdout.split(/\r?\n/).map((line) => line.trim()))
  return names.filter((name) => found.has(name))
}
