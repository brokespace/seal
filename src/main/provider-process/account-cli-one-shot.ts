import { spawnProcess } from '@orca/process-host'
import { reapAccountCliProcess, trackAccountCliProcess } from './account-cli-process-reaper'

const MAX_OUTPUT_CHARS = 4_000

export type AccountCliOneShotResult = {
  code: number | null
  output: string
  timedOut: boolean
}

/** Runs one short provider CLI command to completion; it is killed when the timeout passes. */
export function runAccountCliOnce(args: {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  timeoutMs: number
}): Promise<AccountCliOneShotResult> {
  return new Promise((resolve, reject) => {
    const group = process.platform !== 'win32'
    const child = spawnProcess({
      program: args.command,
      args: args.args,
      env: args.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: group
    })
    trackAccountCliProcess(child, { group })
    let output = ''
    let timedOut = false
    const append = (chunk: Buffer): void => {
      output = `${output}${chunk.toString()}`.slice(-MAX_OUTPUT_CHARS)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timer = setTimeout(() => {
      timedOut = true
      reapAccountCliProcess(child, { group })
    }, args.timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output: output.trim(), timedOut })
    })
  })
}
