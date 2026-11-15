import type { MachineGpu, MachineGpuSnapshot } from '../../../../shared/machines/machine-gpu-types'
import type { MachineProcess } from '../../../../shared/machines/machine-resource-types'
import type { MachineId } from '../../../../shared/machines/machine-types'
import { recordMachineGpuSamples } from './model/machine-gpu-history'

const GIB = 1024 ** 3

type GpuModel = Pick<MachineGpu, 'name' | 'memoryTotalBytes' | 'powerLimitWatts'> & {
  /** Datacenter cards are cooled by the chassis and report no fan. */
  fan: boolean
}

export const RTX_4090: GpuModel = {
  name: 'NVIDIA GeForce RTX 4090',
  memoryTotalBytes: 24_564 * 1024 ** 2,
  powerLimitWatts: 450,
  fan: true
}

export const A100_80GB: GpuModel = {
  name: 'NVIDIA A100-SXM4-80GB',
  memoryTotalBytes: 81_920 * 1024 ** 2,
  powerLimitWatts: 400,
  fan: false
}

/** How busy each GPU of a rig is, as a share: a full training run, an idle card, and between. */
const LOADS = [0.98, 0.94, 0.91, 0.87, 0.52, 0.08, 0.99, 0]

export function fakeGpus(model: GpuModel, count: number, phase = 0): MachineGpu[] {
  return Array.from({ length: count }, (_, index) => {
    const load = Math.min(
      1,
      Math.max(0, LOADS[index % LOADS.length] + Math.sin(phase + index) / 20)
    )
    const busy = load > 0.01
    return {
      index,
      vendor: 'nvidia',
      name: model.name,
      utilizationPercent: Math.round(load * 100),
      memoryUsedBytes: Math.round(
        (model.memoryTotalBytes ?? 0) * (busy ? 0.3 + load * 0.55 : 0.01)
      ),
      memoryTotalBytes: model.memoryTotalBytes,
      temperatureC: Math.round(34 + load * 44),
      powerDrawWatts: Math.round((model.powerLimitWatts ?? 0) * (0.14 + load * 0.8)),
      powerLimitWatts: model.powerLimitWatts,
      fanPercent: model.fan ? Math.round(30 + load * 50) : null,
      clockGraphicsMhz: busy ? 1410 : 210,
      clockMemoryMhz: busy ? 1593 : 405,
      mig: false
    }
  })
}

/** A card split into MIG instances reports its memory but no utilization. */
export function asMig(gpu: MachineGpu): MachineGpu {
  return { ...gpu, mig: true, utilizationPercent: null }
}

export const APPLE_GPU: MachineGpu = {
  index: 0,
  vendor: 'apple',
  name: 'Apple M3 Pro',
  utilizationPercent: 23,
  memoryUsedBytes: 3.4 * GIB,
  memoryTotalBytes: null,
  temperatureC: null,
  powerDrawWatts: null,
  powerLimitWatts: null,
  fanPercent: null,
  clockGraphicsMhz: null,
  clockMemoryMhz: null,
  mig: false
}

const TRAINER_CONTAINER = {
  id: '7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b',
  name: 'jupyter'
}

/** One training job across the first cards, a notebook in a container, and an inference server. */
export function fakeGpuSnapshot(gpus: MachineGpu[]): MachineGpuSnapshot {
  const share = (index: number, part: number): number =>
    Math.round((gpus[index]?.memoryUsedBytes ?? 0) * part)
  const training = gpus.slice(0, Math.min(4, gpus.length)).map((gpu) => ({
    pid: 4127,
    gpuIndex: gpu.index,
    memoryBytes: share(gpu.index, gpus.length > 1 ? 0.97 : 0.7),
    name: 'python',
    container: null
  }))
  const last = gpus.length - 1
  return {
    gpus,
    processes: [
      ...training,
      ...(gpus.length > 4
        ? [
            {
              pid: 61_873,
              gpuIndex: 4,
              memoryBytes: share(4, 0.96),
              name: '/opt/conda/bin/python3.11',
              container: TRAINER_CONTAINER
            },
            {
              pid: 7702,
              gpuIndex: 6,
              memoryBytes: share(6, 0.98),
              name: 'tritonserver',
              container: null
            }
          ]
        : [
            {
              pid: 61_873,
              gpuIndex: last,
              memoryBytes: share(last, gpus.length > 1 ? 0.5 : 0.25),
              name: '/opt/conda/bin/python3.11',
              container: TRAINER_CONTAINER
            }
          ]),
      // Reported by the driver from inside another PID namespace.
      { pid: 934_211, gpuIndex: last, memoryBytes: null, name: 'python3', container: null }
    ]
  }
}

function gpuProcess(
  pid: number,
  name: string,
  command: string,
  cpuPercent: number,
  rssBytes: number,
  extra: Partial<MachineProcess> = {}
): MachineProcess {
  return {
    pid,
    ppid: 1,
    user: 'brian',
    name,
    command,
    cpuPercent,
    memPercent: (rssBytes / (256 * GIB)) * 100,
    rssBytes,
    startMarker: `t${pid}`,
    tmuxPane: null,
    agent: null,
    carriesSealConnection: false,
    ...extra
  }
}

/** The machine's own view of the processes `fakeGpuSnapshot` puts on the GPUs. */
export const GPU_PROCESSES: MachineProcess[] = [
  gpuProcess(4127, 'python', 'python train.py --config configs/vit-l.yaml', 380.4, 41e9, {
    tmuxPane: 'train:0.0'
  }),
  gpuProcess(
    61_873,
    'python3.11',
    '/opt/conda/bin/python3.11 -m ipykernel_launcher -f /root/.local/share/jupyter/runtime/kernel-4be1.json',
    96.2,
    11.8e9,
    { user: 'root' }
  ),
  gpuProcess(
    7702,
    'tritonserver',
    'tritonserver --model-repository=/models --http-port=8000',
    22.7,
    6.4e9,
    { user: 'triton' }
  )
]

/** Fills the sparklines, which otherwise need a few live samples before they draw. */
export function seedFakeGpuHistory(machineId: MachineId, model: GpuModel, count: number): void {
  const start = Date.now() - 40 * 3_000
  for (let step = 0; step < 40; step++) {
    recordMachineGpuSamples(machineId, fakeGpus(model, count, step / 3), start + step * 3_000)
  }
}
