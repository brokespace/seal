import type { MachineExecResult } from '../../../shared/machines/machine-host-wire'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { execCommand, isSshCommandExitError, isSshExecTimeout } from './remote-exec-command'
import { buildSshLoginShellCommand } from './ssh-login-shell-command'

type SshLoginShellTransport = Parameters<typeof execCommand>[0]

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
  conn: SshLoginShellTransport,
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

/**
 * Runs a POSIX script as `sh` would, in the login shell's environment (its PATH), and reports
 * its exit status like a plain exec. The login fence hides the script's own status, so the
 * script reports it in-band. Null when the account names no shell.
 */
export async function runInSshLoginShell(
  conn: SshLoginShellTransport,
  script: string,
  options: { timeoutMs: number; signal?: AbortSignal }
): Promise<MachineExecResult | null> {
  const marker = `__SEAL_LOGIN_EXIT_${Math.random().toString(36).slice(2, 10)}__`
  // sh reads the script because the user's shell may be fish or csh; base64 keeps the login
  // shell's own quoting rules out of it.
  const relay = `sh -c ${quotePosixShell(script)} </dev/null\n__seal_status=$?\nprintf '%s' "${marker}$__seal_status"`
  const payload = `printf %s ${Buffer.from(relay).toString('base64')} | { base64 -d 2>/dev/null || base64 -D; } | sh`
  let stderr = ''
  try {
    const run = await execInSshLoginShell(conn, payload, {
      ...options,
      onStderr: (chunk) => {
        stderr += chunk
      }
    })
    if (!run) {
      return null
    }
    const text = run.stdout ?? ''
    const at = text.lastIndexOf(marker)
    const status = at === -1 ? Number.NaN : Number.parseInt(text.slice(at + marker.length), 10)
    if (!Number.isFinite(status)) {
      // No in-band status: the login shell never ran the script, which is not "command not found".
      return {
        exitCode: null,
        stdout: '',
        stderr: `${stderr}The login shell did not run the command (no exit status came back).`,
        timedOut: false
      }
    }
    return { exitCode: status, stdout: text.slice(0, at), stderr, timedOut: false }
  } catch (error) {
    if (isSshCommandExitError(error)) {
      return { exitCode: error.exitCode, stdout: '', stderr, timedOut: false }
    }
    if (isSshExecTimeout(error)) {
      return { exitCode: null, stdout: '', stderr, timedOut: true }
    }
    throw error
  }
}
