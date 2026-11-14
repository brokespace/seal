import type { LiveSessionMachine } from '../../../shared/live-sessions/live-session-types'
import type { MachineConnection } from '../../machines/connection/machine-connection'
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
    machine: {
      hostId: LOCAL_HOST_ID,
      label,
      kind: 'local',
      machineId: 'local',
      executionHostId: 'local',
      connection: 'local'
    },
    run: runLocalScript,
    transcriptFiles
  }
}

export type LiveSessionMachineSource = {
  recordId: string
  machineId: string
  name: string
  executionHostId: string
  connection: MachineConnection
  /** A Seal server scans with its own `liveSessions.hostRun`; SSH machines run the script over exec. */
  serverRun?: LiveSessionHost['run']
}

/** One host per machine whichever transport it uses, so session ids and routing stay put across switches. */
export function machineLiveSessionHost(source: LiveSessionMachineSource): LiveSessionHost {
  const { connection } = source
  return {
    machine: {
      hostId: source.recordId,
      label: source.name,
      kind: 'remote',
      machineId: source.machineId,
      executionHostId: source.executionHostId,
      connection: connection.transport
    },
    run:
      source.serverRun ??
      (async (script, options) => {
        const result = await connection.exec('sh -s', {
          stdin: PATH_PREFIX + script,
          timeoutMs: options?.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS
        })
        if (result.timedOut) {
          throw new Error('Live session scan timed out')
        }
        return result.stdout
      })
  }
}

const dialects = new Map<string, Promise<void>>()
const knownDialects = new Map<string, 'posix' | 'powershell'>()

/** Connected POSIX machines; Windows hosts have no ps/tmux to read. A machine joins once its shell is known. */
export function connectedMachineHosts(
  sources: readonly LiveSessionMachineSource[]
): LiveSessionHost[] {
  const hosts: LiveSessionHost[] = []
  for (const source of sources) {
    if (!source.connection.isConnected()) {
      continue
    }
    const key = `${source.recordId}:${source.connection.transport}`
    const dialect = knownDialects.get(key)
    if (dialect === 'posix') {
      hosts.push(machineLiveSessionHost(source))
    } else if (!dialect && !dialects.has(key)) {
      dialects.set(
        key,
        source.connection
          .dialect()
          .then((resolved) => {
            knownDialects.set(key, resolved)
          })
          .catch(() => {})
          .finally(() => dialects.delete(key))
      )
    }
  }
  return hosts
}
