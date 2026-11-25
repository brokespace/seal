import { runProcess } from '@orca/process-host'

export const DEFAULT_SCRIPT_TIMEOUT_MS = 20_000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
// Non-interactive shells (launchd, ssh exec, a runtime's service) often lack the dirs agent CLIs and tmux live in.
export const PATH_PREFIX =
  'PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/bin"; export PATH\n'

export async function runLocalScript(
  script: string,
  options?: { timeoutMs?: number; maxOutputBytes?: number }
): Promise<string> {
  const result = await runProcess({
    program: '/bin/sh',
    args: ['-s'],
    input: PATH_PREFIX + script,
    timeoutMs: options?.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS,
    maxOutputBytes: options?.maxOutputBytes ?? MAX_OUTPUT_BYTES
  })
  if (result.timedOut) {
    throw new Error('Live session scan timed out')
  }
  return result.stdout
}
