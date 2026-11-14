import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { encodePowerShellCommand } from '../../../shared/powershell-command-encoding'
import { scriptWithCwd } from '../../home-chat/machines/home-chat-machine-scripts'
import { resolveLoginShellEnvironment } from '../../startup/shell-environment/login-shell-environment'

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
// Linux refuses one argv string past 128 KiB, so longer scripts run from a file.
const MAX_INLINE_SCRIPT_BYTES = 96 * 1024
const LOGIN_ENVIRONMENT_REFRESH_MS = 60_000

export type LocalShellExecOptions = {
  /** Defaults to the home directory, where an SSH exec starts too. */
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

type Invocation = {
  program: string
  args: string[]
  env: NodeJS.ProcessEnv
  cleanup?: () => Promise<void>
}

function powerShellInvocation(script: string): Invocation {
  return {
    program: 'powershell.exe',
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      encodePowerShellCommand(script)
    ],
    env: process.env
  }
}

/**
 * The login shell only supplies the environment. /bin/sh reads the script, because the user's
 * shell may not be POSIX: zsh does not split unquoted variables and fish has its own syntax.
 */
async function posixInvocation(script: string): Promise<Invocation> {
  const env = await resolveLoginShellEnvironment({
    // Keyed by the current environment, so a variable this process changed is not served stale.
    env: process.env,
    refreshAfterMs: LOGIN_ENVIRONMENT_REFRESH_MS
  })
  if (Buffer.byteLength(script) <= MAX_INLINE_SCRIPT_BYTES) {
    return { program: '/bin/sh', args: ['-c', script], env }
  }
  const dir = await mkdtemp(join(tmpdir(), 'seal-exec-'))
  const file = join(dir, 'script.sh')
  await writeFile(file, script, { mode: 0o600 })
  return {
    program: '/bin/sh',
    args: [file],
    env,
    cleanup: () => rm(dir, { recursive: true, force: true })
  }
}

/** Run a script on this machine as the current user: /bin/sh, or PowerShell on Windows. */
export async function runLocalShellScript(
  script: string,
  options: LocalShellExecOptions
): Promise<LocalShellExecResult> {
  const windows = process.platform === 'win32'
  const body = scriptWithCwd(windows ? 'powershell' : 'posix', script, options.cwd)
  const { program, args, env, cleanup } = windows
    ? powerShellInvocation(body)
    : await posixInvocation(body)
  try {
    const result = await runProcess({
      program,
      args,
      // The script changes folder itself, so a missing one is reported instead of failing the spawn.
      cwd: homedir(),
      ...(options.stdin !== undefined ? { input: options.stdin } : {}),
      env,
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
  } finally {
    await cleanup?.()
  }
}
