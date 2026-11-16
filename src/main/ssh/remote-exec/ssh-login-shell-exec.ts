import type { SshConnection } from '../connection/ssh-connection'
import { execCommand } from './remote-exec-command'
import { buildSshLoginShellCommand } from './ssh-login-shell-command'

export type SshLoginShellRun = {
  shell: string
  /** The command's own stdout, or null when the login shell never ran it. */
  stdout: string | null
}

/**
 * Runs `command` in the account's own login shell, whose profile holds the PATH its sessions get.
 * Null when the account names no shell; a command that exits nonzero throws as `execCommand` does.
 */
export async function execInSshLoginShell(
  conn: SshConnection,
  command: string,
  options: { timeoutMs: number; signal?: AbortSignal; onStderr?: (chunk: string) => void }
): Promise<SshLoginShellRun | null> {
  // Respect chsh/passwd SHELL for custom profiles; restricted accounts without it use sh.
  const shellResult = await execCommand(conn, 'echo "${SHELL:-/bin/sh}"', {
    timeoutMs: options.timeoutMs,
    signal: options.signal
  })
  const shell = shellResult.trim().split('\n')[0]
  if (!shell) {
    return null
  }
  const login = buildSshLoginShellCommand(shell, command)
  const stdout = await execCommand(conn, login.command, {
    wrapCommand: false,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    ...(options.onStderr ? { onStderr: options.onStderr } : {})
  })
  return { shell, stdout: login.readStdout(stdout) }
}
