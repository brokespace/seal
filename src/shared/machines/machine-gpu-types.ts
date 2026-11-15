export type MachineGpuVendor = 'nvidia' | 'amd' | 'apple'

/** One GPU's readings. A field is null where the driver does not report it for this card. */
export type MachineGpu = {
  index: number
  vendor: MachineGpuVendor
  name: string
  utilizationPercent: number | null
  memoryUsedBytes: number | null
  /** Null on Apple Silicon, where the GPU shares the machine's memory. */
  memoryTotalBytes: number | null
  temperatureC: number | null
  powerDrawWatts: number | null
  powerLimitWatts: number | null
  /** Null on passively cooled cards. */
  fanPercent: number | null
  clockGraphicsMhz: number | null
  clockMemoryMhz: number | null
  /** Split into MIG instances; the driver then reports no utilization for the whole card. */
  mig: boolean
}

export type MachineGpuContainer = {
  id: string
  /** Null when Docker does not list the container (another runtime, or no access). */
  name: string | null
}

/** One process's use of one GPU; a process on two GPUs is listed once per GPU. */
export type MachineGpuProcess = {
  pid: number
  /** Null when the driver names a device that is not one of the listed GPUs. */
  gpuIndex: number | null
  memoryBytes: number | null
  /** The driver's name for it, shown when the pid is not in the machine's process list. */
  name: string
  container: MachineGpuContainer | null
}

export type MachineGpuSnapshot = {
  gpus: MachineGpu[]
  processes: MachineGpuProcess[]
}

export type MachineGpuSummary = {
  count: number
  /** Mean over the GPUs that report utilization. */
  utilizationPercent: number | null
  memoryUsedBytes: number | null
  memoryTotalBytes: number | null
  /** The hottest GPU. */
  temperatureC: number | null
  powerDrawWatts: number | null
}

/** What the totals are made of; a phone reads only these fields. */
export type MachineGpuReadings = Pick<
  MachineGpu,
  'utilizationPercent' | 'memoryUsedBytes' | 'memoryTotalBytes' | 'temperatureC' | 'powerDrawWatts'
>

function sum(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null)
  return known.length > 0 ? known.reduce((total, value) => total + value, 0) : null
}

export function summarizeMachineGpus(gpus: readonly MachineGpuReadings[]): MachineGpuSummary {
  const busy = gpus.map((gpu) => gpu.utilizationPercent).filter((value) => value !== null)
  const temperatures = gpus.map((gpu) => gpu.temperatureC).filter((value) => value !== null)
  // A card that reports no total would make the used share read too high.
  const sized = gpus.filter((gpu) => gpu.memoryTotalBytes !== null)
  return {
    count: gpus.length,
    utilizationPercent: busy.length > 0 ? (sum(busy) ?? 0) / busy.length : null,
    memoryUsedBytes: sum((sized.length > 0 ? sized : gpus).map((gpu) => gpu.memoryUsedBytes)),
    memoryTotalBytes: sum(sized.map((gpu) => gpu.memoryTotalBytes)),
    temperatureC: temperatures.length > 0 ? Math.max(...temperatures) : null,
    powerDrawWatts: sum(gpus.map((gpu) => gpu.powerDrawWatts))
  }
}
