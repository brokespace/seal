import { parseExecutionHostId } from '../../../shared/execution-host'
import type { MachineId, MachineMetrics } from '../../../shared/machines/machine-types'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { getSshConnectionManager } from '../../ssh/targets/ssh-target-registry'
import { collectLocalMachineMetrics } from './local-machine-metrics'
import { parsePosixMachineMetrics, POSIX_MACHINE_METRICS_COMMAND } from './posix-machine-metrics'
import {
  parseWindowsMachineMetrics,
  WINDOWS_MACHINE_METRICS_COMMAND
} from './windows-machine-metrics'

const METRICS_TIMEOUT_MS = 15_000

type RuntimeMetricsSource = { metrics(): Promise<MachineMetrics> }

export async function collectMachineMetrics(
  machineId: MachineId,
  resolveRuntime: (environmentId: string) => RuntimeMetricsSource
): Promise<MachineMetrics> {
  const parsed = parseExecutionHostId(machineId)
  if (parsed?.kind === 'local') {
    return collectLocalMachineMetrics()
  }
  if (parsed?.kind === 'runtime') {
    return resolveRuntime(parsed.environmentId).metrics()
  }
  if (parsed?.kind !== 'ssh') {
    throw new Error('Unknown machine')
  }
  const conn = getSshConnectionManager()?.getConnection(parsed.targetId)
  if (!conn || conn.getState().status !== 'connected') {
    throw new Error('Machine is not connected')
  }
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
