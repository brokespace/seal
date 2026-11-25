import { describe, expect, it } from 'vitest'
import { summarizeMachineGpus } from '../../../shared/machines/machine-gpu-types'
import { NVIDIA_SMI_FIXTURES } from '../testing/fake-nvidia-smi'
import { parseMachineGpus, parseMachineGpuSnapshot } from './machine-gpu-readings'

const MIB = 1024 ** 2
const FULL_FIELDS =
  'index,uuid,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed,clocks.current.graphics,clocks.current.memory,mig.mode.current,name'
const CORE_FIELDS = 'index,uuid,utilization.gpu,memory.used,memory.total,temperature.gpu,name'

/** What the host script prints for one `nvidia-smi --query-gpu` answer. */
function nvidia(fields: string, rows: readonly string[]): string {
  return [`@nvfields ${fields}`, ...rows.map((row) => `@nv\t${row}`)].join('\n')
}

describe('NVIDIA GPU readings', () => {
  it('reads every figure a desktop card reports', () => {
    expect(parseMachineGpus(nvidia(FULL_FIELDS, NVIDIA_SMI_FIXTURES.oneRtx4090.gpus))).toEqual([
      {
        index: 0,
        vendor: 'nvidia',
        name: 'NVIDIA GeForce RTX 4090',
        utilizationPercent: 87,
        memoryUsedBytes: 20412 * MIB,
        memoryTotalBytes: 24564 * MIB,
        temperatureC: 71,
        powerDrawWatts: 312.45,
        powerLimitWatts: 450,
        fanPercent: 64,
        clockGraphicsMhz: 2520,
        clockMemoryMhz: 10501,
        mig: false
      }
    ])
  })

  it('leaves a figure unknown where the driver prints [N/A], as it does on a MIG card', () => {
    const [desktop, mig] = parseMachineGpus(
      nvidia(FULL_FIELDS, NVIDIA_SMI_FIXTURES.twoWithMig.gpus)
    )

    expect(desktop).toMatchObject({ index: 0, utilizationPercent: 34, fanPercent: 47, mig: false })
    expect(mig).toMatchObject({
      index: 1,
      name: 'NVIDIA A100-SXM4-80GB',
      utilizationPercent: null,
      memoryUsedBytes: 13421 * MIB,
      memoryTotalBytes: 81920 * MIB,
      fanPercent: null,
      powerDrawWatts: 96.71,
      mig: true
    })
  })

  it('reads a card that fell off the bus without dropping the others', () => {
    const gpus = parseMachineGpus(
      nvidia(FULL_FIELDS, [
        '0, GPU-aaaa, [Unknown Error], [Unknown Error], 24564, [Unknown Error], [Unknown Error], 450.00, [Unknown Error], [N/A], [N/A], [N/A], NVIDIA GeForce RTX 4090',
        NVIDIA_SMI_FIXTURES.oneRtx4090.gpus[0].replace(/^0, /, '1, ')
      ])
    )

    expect(gpus.map((gpu) => [gpu.index, gpu.utilizationPercent, gpu.temperatureC])).toEqual([
      [0, null, null],
      [1, 87, 71]
    ])
  })

  it('reads the short field list an old driver answers with', () => {
    const gpus = parseMachineGpus(nvidia(CORE_FIELDS, NVIDIA_SMI_FIXTURES.oldDriverTwoK80.coreGpus))

    expect(gpus).toHaveLength(2)
    expect(gpus[0]).toMatchObject({
      name: 'Tesla K80',
      utilizationPercent: 43,
      memoryUsedBytes: 8754 * MIB,
      memoryTotalBytes: 11441 * MIB,
      temperatureC: 62,
      powerDrawWatts: null,
      powerLimitWatts: null,
      fanPercent: null,
      clockGraphicsMhz: null,
      mig: false
    })
  })

  it('totals eight GPUs for the overview', () => {
    const gpus = parseMachineGpus(nvidia(FULL_FIELDS, NVIDIA_SMI_FIXTURES.eightA100.gpus))

    expect(gpus.map((gpu) => gpu.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    const summary = summarizeMachineGpus(gpus)
    expect(summary).toMatchObject({
      count: 8,
      utilizationPercent: 66.625,
      memoryUsedBytes: 401_147 * MIB,
      memoryTotalBytes: 655_360 * MIB,
      temperatureC: 78
    })
    expect(summary.powerDrawWatts).toBeCloseTo(2153.97, 2)
  })

  it('averages utilization over the GPUs that report it', () => {
    const gpus = parseMachineGpus(nvidia(FULL_FIELDS, NVIDIA_SMI_FIXTURES.twoWithMig.gpus))

    expect(summarizeMachineGpus(gpus).utilizationPercent).toBe(34)
  })
})

describe('the processes on the GPUs', () => {
  const container = 'f3a91c0de2b74c5a9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c'
  const output = [
    nvidia(FULL_FIELDS, NVIDIA_SMI_FIXTURES.eightA100.gpus.slice(0, 2)),
    '@nvapp\tGPU-11111111-aaaa-4bbb-8ccc-000000000000, 41277, 70516, python',
    '@nvapp\tGPU-11111111-aaaa-4bbb-8ccc-000000000001, 41277, 70510, python',
    '@nvapp\tGPU-11111111-aaaa-4bbb-8ccc-000000000001, 61873, 682, /opt/conda/bin/python3.11',
    '@nvapp\tGPU-11111111-aaaa-4bbb-8ccc-000000000001, 7702, [N/A], tritonserver --token abc123',
    '@nvapp\tMIG-6d1e0c5b-93f2-5a7e-b1d4-2c9f8e7a6b50, 9001, 2048, python3',
    `@gpuct\t61873\t${container}`,
    '@gpuct\t7702\t0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    '@ready',
    '@c\tf3a91c0de2b7\tjupyter\tjupyter/pytorch-notebook:latest\tUp 5 hours',
    '@c\t1c2d3e4f5a6b\tpostgres\tpostgres:16\tUp 3 days'
  ].join('\n')

  it('places each process on its GPU, in its container, with its GPU memory', () => {
    expect(parseMachineGpuSnapshot(output).processes).toEqual([
      { pid: 41277, gpuIndex: 0, memoryBytes: 70516 * MIB, name: 'python', container: null },
      { pid: 41277, gpuIndex: 1, memoryBytes: 70510 * MIB, name: 'python', container: null },
      {
        pid: 61873,
        gpuIndex: 1,
        memoryBytes: 682 * MIB,
        name: '/opt/conda/bin/python3.11',
        container: { id: container, name: 'jupyter' }
      },
      {
        pid: 7702,
        gpuIndex: 1,
        memoryBytes: null,
        name: 'tritonserver --token ••••',
        // In a container Docker does not list, so only its id is known.
        container: {
          id: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          name: null
        }
      },
      // The driver named a MIG device, which is not one of the listed GPUs.
      { pid: 9001, gpuIndex: null, memoryBytes: 2048 * MIB, name: 'python3', container: null }
    ])
  })

  it('keeps container ids when Docker is missing', () => {
    const withoutDocker = output.replace(/@ready[\s\S]*$/, '@missing')

    expect(parseMachineGpuSnapshot(withoutDocker).processes[2].container).toEqual({
      id: container,
      name: null
    })
  })
})

describe('GPUs that are not NVIDIA', () => {
  it('reads an AMD card from rocm-smi, after any NVIDIA GPUs', () => {
    const rocm = JSON.stringify({
      card0: {
        'GPU ID': '0x740c',
        'Temperature (Sensor edge) (C)': '38.0',
        'Temperature (Sensor junction) (C)': '41.0',
        'Average Graphics Package Power (W)': '94.0',
        'GPU use (%)': '63',
        'Fan speed (%)': '29.8',
        'VRAM Total Memory (B)': '68702699520',
        'VRAM Total Used Memory (B)': '10850304000',
        'Card series': 'AMD INSTINCT MI250 (MCM) OAM AC MBA',
        'Card model': '0x0b0c',
        'Card vendor': 'Advanced Micro Devices, Inc. [AMD/ATI]'
      },
      system: { 'Driver version': '6.2.4' }
    })
    const gpus = parseMachineGpus(
      [
        nvidia(FULL_FIELDS, NVIDIA_SMI_FIXTURES.oneRtx4090.gpus),
        `@rocm\tWARNING: One or more commands failed${rocm}`
      ].join('\n')
    )

    expect(gpus.map((gpu) => [gpu.index, gpu.vendor])).toEqual([
      [0, 'nvidia'],
      [1, 'amd']
    ])
    expect(gpus[1]).toMatchObject({
      name: 'AMD INSTINCT MI250 (MCM) OAM AC MBA',
      utilizationPercent: 63,
      memoryUsedBytes: 10_850_304_000,
      memoryTotalBytes: 68_702_699_520,
      temperatureC: 41,
      powerDrawWatts: 94,
      fanPercent: 29.8,
      mig: false
    })
  })

  it('reads the Apple Silicon GPU from ioreg, which shares the machine’s memory', () => {
    const gpus = parseMachineGpus(
      [
        '@apple\t"model" = "Apple M3 Pro"',
        '@apple\t"PerformanceStatistics" = {"In use system memory (driver)"=0,"Alloc system memory"=4863655936,"Renderer Utilization %"=11,"Device Utilization %"=23,"In use system memory"=1218461696,"recoveryCount"=0}'
      ].join('\n')
    )

    expect(gpus).toHaveLength(1)
    expect(gpus[0]).toMatchObject({
      index: 0,
      vendor: 'apple',
      name: 'Apple M3 Pro',
      utilizationPercent: 23,
      memoryUsedBytes: 1_218_461_696,
      memoryTotalBytes: null
    })
  })

  it('reports no GPU for a machine with none of the tools', () => {
    expect(parseMachineGpus('@swapkb 0 0\n@total 212')).toEqual([])
    expect(parseMachineGpus('@rocm\t')).toEqual([])
  })
})
