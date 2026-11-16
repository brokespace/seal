import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MachineExecResult } from '../../../shared/machines/machine-host-wire'
import { toMachineId, type MachineMetrics } from '../../../shared/machines/machine-types'
import { createLocalMachineConnection } from '../connection/local-machine-connection'
import type { MachineConnection } from '../connection/machine-connection'
import { NVIDIA_SMI_FIXTURES } from '../testing/fake-nvidia-smi'
import { collectMachineMetricsWithSensors } from './machine-sensor-readings'

const NVIDIA_FIELDS =
  'index,uuid,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed,clocks.current.graphics,clocks.current.memory,mig.mode.current,name'
const RTX_4090 = [
  `@nvfields ${NVIDIA_FIELDS}`,
  ...NVIDIA_SMI_FIXTURES.oneRtx4090.gpus.map((row) => `@nv\t${row}`)
].join('\n')
const K10TEMP = [
  '@cputemp\thwmon\t2\tk10temp\t1\tTctl\t54250',
  '@cputemp\thwmon\t2\tk10temp\t3\tTccd1\t49500'
].join('\n')

describe('a machine’s metrics with its sensors', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const answered = (stdout: string): Promise<MachineExecResult> =>
    Promise.resolve({ stdout, stderr: '', exitCode: 0, timedOut: false })
  const METRICS: MachineMetrics = {
    hostname: 'kessel-ml',
    os: 'linux',
    osRelease: '6.8.0-45-generic',
    arch: 'x64',
    cpuCount: 24,
    cpuModel: null,
    loadAverage: [9.8, 9.1, 8.7],
    cpuUsagePercent: null,
    memTotalBytes: 134_217_728_000,
    memAvailableBytes: 67_108_864_000,
    diskTotalBytes: null,
    diskAvailableBytes: null,
    diskMount: null,
    uptimeSeconds: 432_000,
    homeDir: '/home/brian',
    collectedAt: 1_800_000_000_000
  }
  const never = new Promise<MachineExecResult>(() => {})

  /** A machine whose sensor script answers with whatever `answers` holds next. */
  function machine(
    id: string,
    answers: Promise<MachineExecResult>[],
    dialect: 'posix' | 'powershell' = 'posix'
  ): MachineConnection {
    return {
      ...createLocalMachineConnection(),
      machineId: toMachineId(id),
      isConnected: () => true,
      dialect: async () => dialect,
      metrics: async () => METRICS,
      exec: () => answers.shift() ?? never
    }
  }

  it('go out without sensors when a driver never answers', async () => {
    vi.useFakeTimers()
    const reading = collectMachineMetricsWithSensors(machine('hung-driver', [never]))
    await vi.advanceTimersByTimeAsync(60_000)

    expect(await reading).toEqual(METRICS)
  })

  it('keep the last readings while a slow read is still under way', async () => {
    vi.useFakeTimers()
    const connection = machine('slow-driver', [answered(`${RTX_4090}\n${K10TEMP}`), never])

    const first = await collectMachineMetricsWithSensors(connection)
    const second = collectMachineMetricsWithSensors(connection)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(first.gpus?.map((gpu) => gpu.name)).toEqual(['NVIDIA GeForce RTX 4090'])
    expect(first.cpuTemperature).toEqual({
      temperatureC: 54.3,
      source: 'k10temp',
      sensors: [
        { label: 'Tctl', temperatureC: 54.3 },
        { label: 'Tccd1', temperatureC: 49.5 }
      ]
    })
    expect(await second).toEqual(first)
  })

  it('ask a machine with no sensor again only after a minute', async () => {
    vi.useFakeTimers()
    const connection = machine('gcp-vm', [answered('@os Linux'), answered(K10TEMP)])

    expect(await collectMachineMetricsWithSensors(connection)).toEqual(METRICS)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await collectMachineMetricsWithSensors(connection)).toEqual(METRICS)
    await vi.advanceTimersByTimeAsync(60_000)

    expect((await collectMachineMetricsWithSensors(connection)).cpuTemperature?.temperatureC).toBe(
      54.3
    )
  })

  it('read a Mac with the Mac helper once it has said it is one', async () => {
    const connection = machine('macbook', [
      answered('@os Darwin'),
      answered('@mactemp\tsmc\tTp01\t46.2\n@mactemp\tsmc\tTp0D\t48.6\n@os Darwin')
    ])

    expect((await collectMachineMetricsWithSensors(connection)).cpuTemperature).toEqual({
      temperatureC: 48.6,
      source: 'SMC',
      sensors: [
        { label: 'Tp0D', temperatureC: 48.6 },
        { label: 'Tp01', temperatureC: 46.2 }
      ]
    })
  })

  it('read a Windows machine through PowerShell', async () => {
    const connection = machine(
      'windows-desktop',
      [
        answered(
          'SEAL_CPU_TEMP {"source":"lhm","rows":[{"n":"CPU Package","v":61.5,"i":"/intelcpu/0/temperature/8"}]}\r\n'
        )
      ],
      'powershell'
    )

    expect((await collectMachineMetricsWithSensors(connection)).cpuTemperature).toEqual({
      temperatureC: 61.5,
      source: 'LibreHardwareMonitor',
      sensors: [{ label: 'CPU Package', temperatureC: 61.5 }]
    })
  })
})
