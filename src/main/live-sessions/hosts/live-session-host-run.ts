import { runLocalScript } from './local-shell-script'

// Stays under the runtime's 4 MB JSON response cap; a cut-off scan says so by missing its @@DONE.
const HOST_RUN_MAX_OUTPUT_BYTES = 3 * 1024 * 1024

/** The server side of `liveSessions.hostRun`: a paired desktop's script, run on this machine. */
export async function runLiveSessionHostScript(params: {
  script: string
  timeoutMs?: number
}): Promise<{ stdout: string }> {
  if (process.platform === 'win32') {
    throw new Error('Live sessions need a macOS or Linux server')
  }
  return {
    stdout: await runLocalScript(params.script, {
      timeoutMs: params.timeoutMs,
      maxOutputBytes: HOST_RUN_MAX_OUTPUT_BYTES
    })
  }
}
