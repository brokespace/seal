import { Readable } from 'node:stream'
import type { LiveSessionMachine } from '../../../shared/live-sessions/live-session-types'
import { getSshConnectionManager } from '../../ssh/targets/ssh-target-registry'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import type { TranscriptFileSource } from '../discovery/local-transcript-files'
import { DEFAULT_SCRIPT_TIMEOUT_MS, PATH_PREFIX, runLocalScript } from './local-shell-script'

/** A machine the registry can scan and type into: one shell script in, its stdout back. */
export type LiveSessionHost = {
  machine: LiveSessionMachine
  run(script: string, options?: { timeoutMs?: number }): Promise<string>
  /** Finds transcripts without the script; hosts without one are searched by the script's `find`. */
  transcriptFiles?: TranscriptFileSource
}

export const LOCAL_HOST_ID = 'local'

export function localHost(label: string, transcriptFiles?: TranscriptFileSource): LiveSessionHost {
  return {
    machine: { hostId: LOCAL_HOST_ID, label, kind: 'local' },
    run: runLocalScript,
    transcriptFiles
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
          timeoutMs: options?.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS
        })
    })
  }
  return hosts
}
