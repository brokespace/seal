import type {
  MachineProcessSignal,
  MachineProcessSignalResult
} from '../../../shared/machines/machine-resource-types'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { MachineConnection } from '../connection/machine-connection'
import { runMachineHostScript } from './machine-host-script'

const SIGNAL_TIMEOUT_MS = 15_000

export type MachineProcessSignalRequest = {
  pid: number
  signal: MachineProcessSignal
  /** The marker the process list showed; a reused pid no longer matches it. */
  startMarker: string
}

function signalScript(request: MachineProcessSignalRequest): string {
  const pid = String(request.pid)
  const readMarker = request.startMarker.startsWith('t')
    ? `got=$(awk '{ s = $0; i = 0; while ((j = index(substr(s, i + 1), ")")) > 0) i += j; split(substr(s, i + 2), f, " "); print "t" f[20] }' /proc/${pid}/stat 2>/dev/null)`
    : `got=$(ps -p ${pid} -o lstart= 2>/dev/null | awk '{ $1 = $1; print }')`
  return [
    `want=${quotePosixShell(request.startMarker)}`,
    readMarker,
    'if [ -z "$got" ]; then echo "@gone"; return 0; fi',
    'if [ "$got" != "$want" ]; then echo "@replaced"; return 0; fi',
    `if err=$(kill -${request.signal} ${pid} 2>&1); then echo "@sent"; else printf '@failed %s\\n' "$(printf '%s' "$err" | head -n 1)"; fi`
  ].join('\n')
}

/** Signals one process, and only while it is still the process the user picked. */
export async function signalMachineProcess(
  connection: MachineConnection,
  request: MachineProcessSignalRequest
): Promise<MachineProcessSignalResult> {
  // 0 and negative pids address process groups; pid 1 is init.
  if (!Number.isSafeInteger(request.pid) || request.pid <= 1) {
    throw new Error('Refusing to signal this process id')
  }
  if (request.signal !== 'TERM' && request.signal !== 'KILL') {
    throw new Error('Unsupported signal')
  }
  if (!request.startMarker) {
    throw new Error('The process start marker is required')
  }
  const result = await runMachineHostScript(connection, signalScript(request), {
    timeoutMs: SIGNAL_TIMEOUT_MS
  })
  const line = result.stdout.trim().split(/\r?\n/).pop() ?? ''
  if (line === '@sent') {
    return { outcome: 'sent' }
  }
  if (line === '@gone') {
    return { outcome: 'gone' }
  }
  if (line === '@replaced') {
    return { outcome: 'replaced' }
  }
  const message = line.startsWith('@failed ')
    ? line.slice('@failed '.length).replace(/^.*?kill:\s*/, '')
    : result.stderr.trim()
  return { outcome: 'failed', message: message || 'The signal could not be sent.' }
}
