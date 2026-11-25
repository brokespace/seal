import { runProcess } from '@orca/process-host'
import type { CommandHandler } from '../dispatch/dispatch'
import { rejectRemoteSelectionFlags } from '../dispatch/remote-selection-flag-rejection'
import { RuntimeClientError } from '../runtime/types'
import {
  parseShellIntegrationStatus,
  shellIntegrationScript,
  type ShellIntegrationAction,
  type ShellIntegrationStatus
} from '../../shared/shell-integration/shell-integration-installer'

const TIMEOUT_MS = 60_000

async function runAction(
  action: ShellIntegrationAction,
  ssh: string | null
): Promise<ShellIntegrationStatus> {
  if (process.platform === 'win32' && !ssh) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Shell integration wraps zsh and bash on macOS and Linux; use --ssh <destination> for a remote host'
    )
  }
  const result = await runProcess({
    program: ssh ? 'ssh' : '/bin/sh',
    // `--` keeps a destination that starts with "-" from being read as an ssh option.
    args: ssh ? ['--', ssh, 'sh -s'] : ['-s'],
    input: shellIntegrationScript(action),
    timeoutMs: TIMEOUT_MS
  })
  const status = parseShellIntegrationStatus(result.stdout)
  if (!status) {
    const reason = (result.stderr || result.stdout).trim() || `exit code ${result.code}`
    throw new RuntimeClientError('runtime_error', `shell-integration ${action} failed: ${reason}`)
  }
  return status
}

function describe(action: ShellIntegrationAction, status: ShellIntegrationStatus): string {
  const lines = [
    `Installed: ${status.installed ? 'yes' : 'no'}`,
    `Wrapping: ${status.enabled ? 'on' : 'off'}`,
    `tmux: ${status.tmux ?? 'not found (claude and codex run unwrapped until tmux 3.0+ is installed)'}`,
    `Shell rc files: ${status.rcFiles.join(', ') || 'none'}`
  ]
  if (action === 'install' || action === 'uninstall') {
    lines.push('Open a new shell (or `exec $SHELL`) for the change to take effect.')
  }
  return lines.join('\n')
}

function handler(action: ShellIntegrationAction): CommandHandler {
  return async ({ flags, json }) => {
    rejectRemoteSelectionFlags(flags, 'shell-integration; use --ssh <destination>')
    const ssh = flags.get('ssh')
    if (ssh === true) {
      throw new RuntimeClientError('invalid_argument', '--ssh needs a destination')
    }
    const status = await runAction(action, typeof ssh === 'string' ? ssh : null)
    console.log(json ? JSON.stringify(status, null, 2) : describe(action, status))
  }
}

export const SHELL_INTEGRATION_HANDLERS: Record<string, CommandHandler> = {
  'shell-integration install': handler('install'),
  'shell-integration uninstall': handler('uninstall'),
  'shell-integration status': handler('status'),
  'shell-integration enable': handler('enable'),
  'shell-integration disable': handler('disable')
}
