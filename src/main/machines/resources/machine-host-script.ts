import type { MachineExecResult } from '../../../shared/machines/machine-host-wire'
import { PATH_PREFIX } from '../../live-sessions/hosts/local-shell-script'
import type { MachineConnection } from '../connection/machine-connection'

/**
 * Runs a POSIX script on a machine the same way over every transport. The script goes in on stdin
 * of `sh -s`, so the login shell (zsh, bash, fish) only ever parses those two words. The body is a
 * function called with stdin closed: the shell has read all of it before anything runs, and no
 * command inside can swallow the rest of the script.
 */
export async function runMachineHostScript(
  connection: MachineConnection,
  body: string,
  options: { timeoutMs: number; signal?: AbortSignal }
): Promise<MachineExecResult> {
  if ((await connection.dialect()) !== 'posix') {
    throw new Error('This is only available on Linux and macOS machines.')
  }
  const script = `${PATH_PREFIX}LC_ALL=C; export LC_ALL\nseal_host_script() {\n${body}\n}\nseal_host_script </dev/null\n`
  const result = await connection.exec('sh -s', {
    stdin: script,
    timeoutMs: options.timeoutMs,
    ...(options.signal ? { signal: options.signal } : {})
  })
  if (result.timedOut) {
    throw new Error('The machine took too long to answer.')
  }
  return result
}

/** The first line a failed command printed, for showing to the user. */
export function firstErrorLine(result: MachineExecResult): string {
  const line = (result.stderr.trim() || result.stdout.trim()).split(/\r?\n/)[0]?.trim()
  return line || `The command exited with status ${result.exitCode ?? 'unknown'}.`
}
