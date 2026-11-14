import { execFileSync } from 'node:child_process'
import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { parsePosixMachineMetrics, POSIX_MACHINE_METRICS_COMMAND } from './posix-machine-metrics'

describe('parsePosixMachineMetrics', () => {
  it('reads the macOS branch (bytes, sysctl load and boot time)', () => {
    const output = [
      'hostname=studio.local',
      'os=Darwin',
      'release=23.5.0',
      'arch=arm64',
      'home=/Users/brian',
      'memtotal_b=34359738368',
      'memavail_b=8589934592',
      'cpus=12',
      'cpumodel=Apple M2 Max',
      'loadavg= 2.50 2.00 1.50 ',
      'boottime=1700000000',
      'now=1700090000',
      'pretty=macOS 14.5',
      'disk=976490576 488245288 /System/Volumes/Data'
    ].join('\n')

    expect(parsePosixMachineMetrics(output, 42)).toEqual({
      hostname: 'studio.local',
      os: 'darwin',
      osRelease: 'macOS 14.5',
      arch: 'arm64',
      cpuCount: 12,
      cpuModel: 'Apple M2 Max',
      loadAverage: [2.5, 2, 1.5],
      cpuUsagePercent: null,
      memTotalBytes: 34359738368,
      memAvailableBytes: 8589934592,
      diskTotalBytes: 976490576 * 1024,
      diskAvailableBytes: 488245288 * 1024,
      diskMount: '/System/Volumes/Data',
      uptimeSeconds: 90000,
      homeDir: '/Users/brian',
      collectedAt: 42
    })
  })

  it('leaves missing probes null instead of guessing', () => {
    const metrics = parsePosixMachineMetrics('os=Linux\nloadavg=\ncpus=abc\n', 1)
    expect(metrics.os).toBe('linux')
    expect(metrics.loadAverage).toBeNull()
    expect(metrics.cpuCount).toBeNull()
    expect(metrics.memTotalBytes).toBeNull()
    expect(metrics.uptimeSeconds).toBeNull()
  })

  it.skipIf(process.platform === 'win32')('matches what this host reports through node', () => {
    const output = execFileSync('sh', ['-c', POSIX_MACHINE_METRICS_COMMAND], { encoding: 'utf8' })
    const metrics = parsePosixMachineMetrics(output, 0)
    expect(metrics.os).toBe(process.platform)
    expect(metrics.homeDir).toBe(os.homedir())
    expect(metrics.memTotalBytes).not.toBeNull()
    // Kernel and node can round total memory differently by a few MB.
    expect(Math.abs((metrics.memTotalBytes ?? 0) - os.totalmem())).toBeLessThan(64 * 1024 * 1024)
    expect(metrics.diskTotalBytes).toBeGreaterThan(0)
    expect(metrics.loadAverage).toHaveLength(3)
  })
})
