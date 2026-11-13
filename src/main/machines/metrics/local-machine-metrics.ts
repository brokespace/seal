import os from 'node:os'
import { statfs } from 'node:fs/promises'
import type { MachineMetrics, MachineOs } from '../../../shared/machines/machine-types'

function localOs(): MachineOs | null {
  const platform = process.platform
  return platform === 'linux' || platform === 'darwin' || platform === 'win32' ? platform : null
}

export async function collectLocalMachineMetrics(now = Date.now()): Promise<MachineMetrics> {
  const home = os.homedir()
  const cpus = os.cpus()
  const disk = await statfs(home).catch(() => null)
  const load = os.loadavg()
  return {
    hostname: os.hostname(),
    os: localOs(),
    osRelease: os.version?.() || os.release(),
    arch: os.arch(),
    cpuCount: cpus.length || null,
    cpuModel: cpus[0]?.model?.trim() || null,
    // Windows always reports zeros, which would read as an idle machine.
    loadAverage: process.platform === 'win32' ? null : [load[0], load[1], load[2]],
    memTotalBytes: os.totalmem(),
    memAvailableBytes: os.freemem(),
    diskTotalBytes: disk ? disk.blocks * disk.bsize : null,
    diskAvailableBytes: disk ? disk.bavail * disk.bsize : null,
    diskMount: disk ? home : null,
    uptimeSeconds: Math.floor(os.uptime()),
    homeDir: home,
    collectedAt: now
  }
}
