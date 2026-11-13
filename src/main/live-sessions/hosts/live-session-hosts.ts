import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import type { LiveSessionMachine } from '../../../shared/live-sessions/live-session-types'
import { getSshConnectionManager } from '../../ssh/targets/ssh-target-registry'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'

/** A machine the registry can scan and type into: one shell script in, its stdout back. */
export type LiveSessionHost = {
  machine: LiveSessionMachine
  run(script: string, options?: { timeoutMs?: number }): Promise<string>
}

export const LOCAL_HOST_ID = 'local'
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
// Non-interactive shells (launchd, ssh exec) often lack the dirs agent CLIs and tmux live in.
const PATH_PREFIX =
  'PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/bin"; export PATH\n'

export function runLocalScript(script: string, options?: { timeoutMs?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-s'], { stdio: ['pipe', 'pipe', 'ignore'] })
    const chunks: Buffer[] = []
    let bytes = 0
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Live session scan timed out'))
    }, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes <= MAX_OUTPUT_BYTES) {
        chunks.push(chunk)
      }
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    child.stdin.end(PATH_PREFIX + script)
  })
}

export function localHost(label: string): LiveSessionHost {
  return {
    machine: { hostId: LOCAL_HOST_ID, label, kind: 'local' },
    run: runLocalScript
  }
}

/** Connected SSH targets with a POSIX shell; Windows hosts have no ps/tmux to read. */
export function connectedSshHosts(): LiveSessionHost[] {
  const manager = getSshConnectionManager()
  if (!manager) {
    return []
  }
  const hosts: LiveSessionHost[] = []
  for (const [targetId, state] of manager.getAllStates()) {
    const connection = manager.getConnection(targetId)
    if (state.status !== 'connected' || !connection || state.remotePlatform === 'win32') {
      continue
    }
    hosts.push({
      machine: { hostId: targetId, label: connection.getTarget().label, kind: 'ssh' },
      run: (script, options) =>
        execCommand(connection, 'sh -s', {
          stdin: Readable.from([PATH_PREFIX + script]),
          timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
        })
    })
  }
  return hosts
}
