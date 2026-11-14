import type {
  AgentConfigCommandResult,
  AgentConfigPluginCommand,
  AgentConfigScope,
  AgentConfigTarget,
  AgentConfigWriteResult
} from '../../shared/agent-config/agent-config-types'
import { quotePosixShell } from '../../shared/shell/launch/shell-argument-quoting'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { patchSettings } from './agent-config-settings-ops'

/** Installing clones a repository; a slow link needs room. */
const COMMAND_TIMEOUT_MS = 5 * 60_000
const MAX_OUTPUT_CHARS = 4_000
const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*(@[A-Za-z0-9][A-Za-z0-9._-]*)?$/
const MARKETPLACE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
// eslint-disable-next-line no-control-regex -- strips the terminal colours the CLI prints.
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/g

function requirePlugin(plugin: unknown): string {
  if (typeof plugin !== 'string' || !PLUGIN_ID.test(plugin)) {
    throw new Error('Name the plugin as name@marketplace')
  }
  return plugin
}

function requireScope(scope: unknown): AgentConfigScope {
  if (scope !== 'user' && scope !== 'project' && scope !== 'local') {
    throw new Error('Unknown scope')
  }
  return scope
}

/** The `claude plugin` arguments for an action, exactly as a person would type them. */
export function pluginCommandArgs(command: AgentConfigPluginCommand): string[] {
  switch (command.kind) {
    case 'install':
      return [
        'plugin',
        'install',
        requirePlugin(command.plugin),
        '--scope',
        requireScope(command.scope)
      ]
    case 'uninstall':
      return [
        'plugin',
        'uninstall',
        requirePlugin(command.plugin),
        '--scope',
        requireScope(command.scope)
      ]
    case 'update':
      return [
        'plugin',
        'update',
        requirePlugin(command.plugin),
        '--scope',
        requireScope(command.scope)
      ]
    case 'marketplace-add': {
      const source = typeof command.source === 'string' ? command.source.trim() : ''
      if (source === '' || source.startsWith('-') || /[\n\r\0]/.test(source)) {
        throw new Error('Enter owner/repo, a git URL or a folder')
      }
      return ['plugin', 'marketplace', 'add', source]
    }
    case 'marketplace-remove':
      if (typeof command.name !== 'string' || !MARKETPLACE_NAME.test(command.name)) {
        throw new Error('That is not a marketplace name')
      }
      return ['plugin', 'marketplace', 'remove', command.name]
    case 'marketplace-update':
      if (
        command.name !== null &&
        (typeof command.name !== 'string' || !MARKETPLACE_NAME.test(command.name))
      ) {
        throw new Error('That is not a marketplace name')
      }
      return ['plugin', 'marketplace', 'update', ...(command.name ? [command.name] : [])]
  }
}

function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Installs, updates and removes go through Claude Code's own CLI on the machine: it clones the
 * repositories, resolves versions and writes its registry, which Seal should not imitate.
 */
export async function runPluginCommand(
  connection: MachineConnection,
  args: { target: AgentConfigTarget; command: AgentConfigPluginCommand }
): Promise<AgentConfigCommandResult> {
  const argv = pluginCommandArgs(args.command)
  const powershell = (await connection.dialect()) === 'powershell'
  const script = powershell
    ? `& claude ${argv.map(powerShellLiteral).join(' ')}; exit $LASTEXITCODE`
    : `command -v claude >/dev/null 2>&1 || { echo 'Claude Code is not installed on this machine (claude is not on the PATH).' >&2; exit 127; }\nclaude ${argv.map(quotePosixShell).join(' ')} </dev/null`
  const result = await connection.exec(script, {
    timeoutMs: COMMAND_TIMEOUT_MS,
    // Project and local installs are recorded against the folder the CLI runs in.
    ...(args.target.projectPath ? { cwd: args.target.projectPath } : {})
  })
  const output = `${result.stdout}\n${result.stderr}`.replace(ANSI, '').trim()
  return {
    ok: result.exitCode === 0 && !result.timedOut,
    command: `claude ${argv.join(' ')}`,
    output: result.timedOut
      ? `${output}\nTimed out after ${COMMAND_TIMEOUT_MS / 60_000} minutes`.trim()
      : output.slice(-MAX_OUTPUT_CHARS)
  }
}

/** Switching a plugin on or off is one key in a settings file; no CLI needed. */
export function setPluginEnabled(
  connection: MachineConnection,
  args: {
    target: AgentConfigTarget
    scope: AgentConfigScope
    plugin: string
    /** Null removes this scope's say, so a weaker scope decides again. */
    enabled: boolean | null
  }
): Promise<AgentConfigWriteResult> {
  const path = ['enabledPlugins', requirePlugin(args.plugin)]
  return patchSettings(connection, {
    target: args.target,
    scope: args.scope,
    edits: [args.enabled === null ? { path, remove: true } : { path, value: args.enabled }]
  })
}
