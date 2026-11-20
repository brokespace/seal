import { runProcess } from '@orca/process-host'
import { getAppEnvironment } from '../../../shared/app-environment'
import { prependOrcaCliDirToChildPath } from '../../cli/launchers/orca-cli-child-path'
import type { HomeChatExecResult } from '../machines/home-chat-machine-types'

function launchEnv(): { env: Record<string, string>; launcher: string | null } {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }
  const launcher = prependOrcaCliDirToChildPath(env, {
    isPackaged: getAppEnvironment().isPackaged(),
    userDataPath: getAppEnvironment().getPath('userData'),
    resourcesPath: process.resourcesPath
  })
  return { env, launcher }
}

/** Run this app's own CLI, so the assistant drives the same Orca instance it lives in. */
export async function runOrcaCli(
  args: readonly string[],
  options: { timeoutMs: number; signal?: AbortSignal }
): Promise<HomeChatExecResult> {
  const { env, launcher } = launchEnv()
  const program = launcher ?? 'orca'
  // .cmd launchers only run through cmd.exe; the native launcher and POSIX scripts run directly.
  const viaCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(program)
  const result = await runProcess({
    program: viaCmd ? (process.env.ComSpec ?? 'cmd.exe') : program,
    args: viaCmd ? ['/d', '/s', '/c', program, ...args] : args,
    env,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    maxOutputBytes: 2 * 1024 * 1024
  })
  return {
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut
  }
}
