import { findClaudeExecutableIndex } from './agent-launch/startup/agent-resume-launch-command'
import {
  isSpliceableStartupCommand,
  quoteStartupArg,
  tokenizeStartupCommand,
  type AgentStartupShell
} from './agent-launch/startup/tui-agent-startup-shell'

export function withClaudeAgentViewPlugin(
  command: string,
  root: string,
  shell: AgentStartupShell
): string {
  return withClaudeCommandArgs(command, ['--plugin-dir', root], shell)
}

/** Inserts args right after a lone `claude` executable; anything unusual leaves the command alone. */
export function withClaudeCommandArgs(
  command: string,
  args: readonly string[],
  shell: AgentStartupShell
): string {
  if (args.length === 0) {
    return command
  }
  const parsed = tokenizeStartupCommand(command, shell)
  if (!parsed.ok) {
    return command
  }
  const index = findClaudeExecutableIndex(parsed.tokens, shell)
  if (
    index < 0 ||
    parsed.tokens
      .slice(0, index)
      .some(
        (token, at) =>
          !(
            (shell === 'posix' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) ||
            (shell === 'powershell' && at === 0 && token === '&')
          )
      )
  ) {
    return command
  }
  if (
    !isSpliceableStartupCommand(
      command,
      parsed,
      (token, at) => shell === 'powershell' && at === 0 && token === '&'
    )
  ) {
    return command
  }
  const end = parsed.spans[index].end
  const inserted = args.map((arg) => quoteStartupArg(arg, shell)).join(' ')
  return `${command.slice(0, end)} ${inserted}${command.slice(end)}`
}
