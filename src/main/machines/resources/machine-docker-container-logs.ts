import {
  MACHINE_DOCKER_LOG_TAIL_LINES,
  type MachineDockerLogs
} from '../../../shared/machines/machine-docker-types'
import type { MachineConnection } from '../connection/machine-connection'
import { DOCKER_CONTAINER_ID, dockerObjectError } from './machine-docker-output'
import { runMachineHostScript } from './machine-host-script'

const LOGS_TIMEOUT_MS = 60_000
/** One answer has to fit the transport's output cap; a longer log keeps its end. */
export const DOCKER_LOG_MAX_BYTES = 512 * 1024

/** Reads `docker logs` output that ends with an `@status <exit code>` line. */
export function parseDockerLogs(
  output: string,
  collectedAt: number,
  maxBytes = DOCKER_LOG_MAX_BYTES
): MachineDockerLogs {
  const status = /\n@status (\d+)\n?$/.exec(output)
  let text = status ? output.slice(0, status.index) : output
  if (status && status[1] !== '0') {
    throw dockerObjectError(
      'container',
      text.split(/\r?\n/).find((line) => line.trim() !== '') ?? 'Docker could not read the log.'
    )
  }
  const cut = Buffer.byteLength(output) >= maxBytes
  if (cut) {
    // The cap lands mid-line, so the first line is dropped whole.
    text = text.slice(text.indexOf('\n') + 1)
  }
  const lines = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length
  return { text, truncated: cut || lines >= MACHINE_DOCKER_LOG_TAIL_LINES, collectedAt }
}

export async function readMachineDockerContainerLogs(
  connection: MachineConnection,
  containerId: string
): Promise<MachineDockerLogs> {
  if (!DOCKER_CONTAINER_ID.test(containerId)) {
    throw new Error('Unknown container')
  }
  // `tail` keeps the status line, which the pipe would otherwise lose.
  const script = `{ docker logs --tail ${MACHINE_DOCKER_LOG_TAIL_LINES} --timestamps ${containerId} 2>&1; printf '\\n@status %s\\n' "$?"; } | tail -c ${DOCKER_LOG_MAX_BYTES}`
  const result = await runMachineHostScript(connection, script, { timeoutMs: LOGS_TIMEOUT_MS })
  return parseDockerLogs(result.stdout, Date.now())
}
