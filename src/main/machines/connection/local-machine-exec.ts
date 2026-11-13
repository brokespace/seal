import { runProcess } from '@orca/process-host'
import { encodePowerShellCommand } from '../../../shared/powershell-command-encoding'
import type { MachineExecResult } from '../../../shared/machines/machine-host-wire'

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

export type MachineExecOptions = {
  cwd?: string
  timeoutMs: number
  signal?: AbortSignal
  /** Piped to the script's stdin, then EOF. */
  stdin?: string | Buffer
}

function shellInvocation(command: string): { program: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      program: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        encodePowerShellCommand(command)
      ]
    }
  }
  return { program: process.env.SHELL || '/bin/sh', args: ['-lc', command] }
}

/** Runs a script in this machine's login shell (PowerShell on Windows). */
export async function execOnThisMachine(
  command: string,
  options: MachineExecOptions
): Promise<MachineExecResult> {
  const { program, args } = shellInvocation(command)
  const result = await runProcess({
    program,
    args,
    cwd: options.cwd,
    ...(options.stdin !== undefined ? { input: options.stdin } : {}),
    env: process.env,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    maxOutputBytes: MAX_OUTPUT_BYTES
  })
  return {
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut
  }
}
