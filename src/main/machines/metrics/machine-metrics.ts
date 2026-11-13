import { parseExecutionHostId } from '../../../shared/execution-host'
import type { MachineId, MachineMetrics } from '../../../shared/machines/machine-types'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { getSshConnectionManager } from '../../ssh/targets/ssh-target-registry'
import { collectLocalMachineMetrics } from './local-machine-metrics'
import { parsePosixMachineMetrics, POSIX_MACHINE_METRICS_COMMAND } from './posix-machine-metrics'

const METRICS_TIMEOUT_MS = 15_000

function windowsPlaceholder(now: number): MachineMetrics {
  return {
    hostname: null,
    os: 'win32',
    osRelease: null,
    arch: null,
    cpuCount: null,
    cpuModel: null,
    loadAverage: null,
    memTotalBytes: null,
    memAvailableBytes: null,
    diskTotalBytes: null,
    diskAvailableBytes: null,
    diskMount: null,
    uptimeSeconds: null,
    homeDir: null,
    collectedAt: now
  }
}

export async function collectMachineMetrics(machineId: MachineId): Promise<MachineMetrics> {
  const parsed = parseExecutionHostId(machineId)
  if (parsed?.kind === 'local') {
    return collectLocalMachineMetrics()
  }
  if (parsed?.kind !== 'ssh') {
    throw new Error('Metrics are only collected for this computer and SSH machines')
  }
  const conn = getSshConnectionManager()?.getConnection(parsed.targetId)
  if (!conn || conn.getState().status !== 'connected') {
    throw new Error('Machine is not connected')
  }
  if (conn.getState().remotePlatform === 'win32') {
    return windowsPlaceholder(Date.now())
  }
  const output = await execCommand(conn, POSIX_MACHINE_METRICS_COMMAND, {
    timeoutMs: METRICS_TIMEOUT_MS
  })
  return parsePosixMachineMetrics(output, Date.now())
}
