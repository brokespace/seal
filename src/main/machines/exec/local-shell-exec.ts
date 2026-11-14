import { runProcess } from '@orca/process-host'
import { encodePowerShellCommand } from '../../../shared/powershell-command-encoding'

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

export type LocalShellExecOptions = {
  cwd?: string
  timeoutMs: number
  signal?: AbortSignal
  /** Piped to the script's stdin, then EOF. */
  stdin?: string | Buffer
  /** Cap per stream; defaults to 4 MiB. */
  maxOutputBytes?: number
}

export type LocalShellExecResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

function shellInvocation(script: string): { program: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      program: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        encodePowerShellCommand(script)
      ]
    }
  }
  return { program: process.env.SHELL || '/bin/sh', args: ['-lc', script] }
}

/** Run a script in this machine's login shell (PowerShell on Windows) as the current user. */
export async function runLocalShellScript(
  script: string,
  options: LocalShellExecOptions
): Promise<LocalShellExecResult> {
  const { program, args } = shellInvocation(script)
  const result = await runProcess({
    program,
    args,
    cwd: options.cwd,
    ...(options.stdin !== undefined ? { input: options.stdin } : {}),
    env: process.env,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    maxOutputBytes: options.maxOutputBytes ?? MAX_OUTPUT_BYTES
  })
  return {
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut
  }
}
