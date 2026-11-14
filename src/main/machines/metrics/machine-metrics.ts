import type { MachineMetrics } from '../../../shared/machines/machine-types'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import type { SshMachineLink } from '../connection/ssh-machine-link'
import { parsePosixMachineMetrics, POSIX_MACHINE_METRICS_COMMAND } from './posix-machine-metrics'
import {
  parseWindowsMachineMetrics,
  WINDOWS_MACHINE_METRICS_COMMAND
} from './windows-machine-metrics'

const METRICS_TIMEOUT_MS = 15_000

export async function collectSshMachineMetrics(conn: SshMachineLink): Promise<MachineMetrics> {
  if (conn.getState().remotePlatform === 'win32') {
    // PowerShell output is not POSIX-fenced; the parser finds its own marked line instead.
    const output = await execCommand(conn, WINDOWS_MACHINE_METRICS_COMMAND, {
      timeoutMs: METRICS_TIMEOUT_MS,
      wrapCommand: false
    })
    return parseWindowsMachineMetrics(output, Date.now())
  }
  const output = await execCommand(conn, POSIX_MACHINE_METRICS_COMMAND, {
    timeoutMs: METRICS_TIMEOUT_MS
  })
  return parsePosixMachineMetrics(output, Date.now())
}
