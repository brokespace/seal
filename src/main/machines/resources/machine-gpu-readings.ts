import type {
  MachineGpu,
  MachineGpuProcess,
  MachineGpuSnapshot
} from '../../../shared/machines/machine-gpu-types'
import type { MachineId, MachineMetrics } from '../../../shared/machines/machine-types'
import type { MachineConnection } from '../connection/machine-connection'
import { maskCommandLineSecrets } from './command-line-secrets'
import { parseDockerContainers } from './machine-docker-containers'
import { MACHINE_GPU_READINGS_SCRIPT } from './machine-gpu-host-scripts'
import { runMachineHostScript } from './machine-host-script'

const READ_TIMEOUT_MS = 20_000
const NO_GPU_RECHECK_MS = 60_000
const MIB = 1024 ** 2
const PROCESS_NAME_MAX_CHARS = 200

/** `[N/A]`, `[Not Supported]` and the like read as unknown. */
function reading(text: string | undefined): number | null {
  const trimmed = (text ?? '').trim()
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : null
}

function scaled(value: number | null, factor: number): number | null {
  return value === null ? null : Math.round(value * factor)
}

type NvidiaGpu = { gpu: MachineGpu; uuid: string }

function parseNvidiaGpus(lines: string[]): NvidiaGpu[] {
  const fields = lines
    .find((line) => line.startsWith('@nvfields '))
    ?.slice('@nvfields '.length)
    .trim()
    .split(',')
  if (!fields) {
    return []
  }
  const found: NvidiaGpu[] = []
  for (const line of lines) {
    if (!line.startsWith('@nv\t')) {
      continue
    }
    const cells = line.slice('@nv\t'.length).split(', ')
    const cell = (field: string): string | undefined => {
      const at = fields.indexOf(field)
      return at === -1 ? undefined : cells[at]
    }
    const index = reading(cell('index'))
    if (index === null || cells.length < fields.length) {
      continue
    }
    found.push({
      uuid: (cell('uuid') ?? '').trim(),
      gpu: {
        index,
        vendor: 'nvidia',
        name: cells.slice(fields.indexOf('name')).join(', ').trim() || 'NVIDIA GPU',
        utilizationPercent: reading(cell('utilization.gpu')),
        memoryUsedBytes: scaled(reading(cell('memory.used')), MIB),
        memoryTotalBytes: scaled(reading(cell('memory.total')), MIB),
        temperatureC: reading(cell('temperature.gpu')),
        powerDrawWatts: reading(cell('power.draw')),
        powerLimitWatts: reading(cell('power.limit')),
        fanPercent: reading(cell('fan.speed')),
        clockGraphicsMhz: reading(cell('clocks.current.graphics')),
        clockMemoryMhz: reading(cell('clocks.current.memory')),
        mig: cell('mig.mode.current')?.trim() === 'Enabled'
      }
    })
  }
  return found
}

function bareGpu(index: number, vendor: MachineGpu['vendor'], name: string): MachineGpu {
  return {
    index,
    vendor,
    name,
    utilizationPercent: null,
    memoryUsedBytes: null,
    memoryTotalBytes: null,
    temperatureC: null,
    powerDrawWatts: null,
    powerLimitWatts: null,
    fanPercent: null,
    clockGraphicsMhz: null,
    clockMemoryMhz: null,
    mig: false
  }
}

/** `rocm-smi --json` names its keys differently from release to release, so they are matched loosely. */
function parseRocmGpus(lines: string[], firstIndex: number): MachineGpu[] {
  const raw = lines.find((line) => line.startsWith('@rocm\t'))?.slice('@rocm\t'.length) ?? ''
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return []
  }
  let cards: unknown
  try {
    cards = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  if (typeof cards !== 'object' || cards === null) {
    return []
  }
  const found: { card: number; gpu: MachineGpu }[] = []
  for (const [key, value] of Object.entries(cards)) {
    const card = /^card(\d+)$/.exec(key)
    if (!card || typeof value !== 'object' || value === null) {
      continue
    }
    const entries = Object.entries(value as Record<string, unknown>)
    const text = (...names: RegExp[]): string | undefined => {
      for (const name of names) {
        const match = entries.find(([entry]) => name.test(entry))
        if (match && (typeof match[1] === 'string' || typeof match[1] === 'number')) {
          return String(match[1])
        }
      }
      return undefined
    }
    const name = text(/^card series$/i, /^device name$/i, /^card model$/i)
    found.push({
      card: Number(card[1]),
      gpu: {
        ...bareGpu(0, 'amd', name && !/^(n\/a|0x)/i.test(name) ? name : 'AMD GPU'),
        utilizationPercent: reading(text(/^gpu use \(%\)$/i)),
        memoryUsedBytes: reading(text(/^vram total used memory \(b\)$/i)),
        memoryTotalBytes: reading(text(/^vram total memory \(b\)$/i)),
        temperatureC: reading(text(/^temperature \(sensor junction\)/i, /^temperature/i)),
        powerDrawWatts: reading(text(/power \(w\)$/i)),
        fanPercent: reading(text(/^fan speed \(%\)$/i))
      }
    })
  }
  return found
    .sort((a, b) => a.card - b.card)
    .map(({ gpu }, position) => ({ ...gpu, index: firstIndex + position }))
}

/** Apple Silicon has one GPU on shared memory: `ioreg` gives its model, load and memory in use. */
function parseAppleGpu(lines: string[], index: number): MachineGpu[] {
  const rows = lines
    .filter((line) => line.startsWith('@apple\t'))
    .map((line) => line.slice('@apple\t'.length))
  const stats = rows.find((row) => row.includes('"Device Utilization %"'))
  const model = /^"model" = <?"([^"]+)"/.exec(
    rows.find((row) => row.startsWith('"model"')) ?? ''
  )?.[1]
  if (!stats && !model) {
    return []
  }
  const stat = (name: string): number | null =>
    reading(new RegExp(`"${name}"=(\\d+)`).exec(stats ?? '')?.[1])
  return [
    {
      ...bareGpu(index, 'apple', model ?? 'Apple GPU'),
      utilizationPercent: stat('Device Utilization %'),
      memoryUsedBytes: stat('In use system memory')
    }
  ]
}

function gpuLines(output: string): string[] {
  return output.split(/\r?\n/)
}

function parseGpus(lines: string[]): { gpus: MachineGpu[]; nvidia: NvidiaGpu[] } {
  const nvidia = parseNvidiaGpus(lines).sort((a, b) => a.gpu.index - b.gpu.index)
  const gpus = nvidia.map(({ gpu }) => gpu)
  const next = (): number => gpus.reduce((highest, gpu) => Math.max(highest, gpu.index + 1), 0)
  gpus.push(...parseRocmGpus(lines, next()))
  gpus.push(...parseAppleGpu(lines, next()))
  return { gpus, nvidia }
}

export function parseMachineGpus(output: string): MachineGpu[] {
  return parseGpus(gpuLines(output)).gpus
}

/** Reads what `MACHINE_GPU_READINGS_SCRIPT` and `MACHINE_GPU_PROCESSES_SCRIPT` printed. */
export function parseMachineGpuSnapshot(output: string): MachineGpuSnapshot {
  const lines = gpuLines(output)
  const { gpus, nvidia } = parseGpus(lines)
  const containerOf = new Map<number, string>()
  for (const line of lines) {
    if (line.startsWith('@gpuct\t')) {
      const [pid, id] = line.split('\t').slice(1)
      containerOf.set(Number(pid), id)
    }
  }
  const docker = containerOf.size > 0 ? parseDockerContainers(output) : null
  const containers = docker?.state === 'ready' ? docker.containers : []
  const processes: MachineGpuProcess[] = []
  for (const line of lines) {
    if (!line.startsWith('@nvapp\t')) {
      continue
    }
    const [uuid, pidText, memory, ...name] = line.slice('@nvapp\t'.length).split(', ')
    const pid = reading(pidText)
    if (pid === null) {
      continue
    }
    const containerId = containerOf.get(pid)
    processes.push({
      pid,
      gpuIndex: nvidia.find((entry) => entry.uuid === uuid.trim())?.gpu.index ?? null,
      memoryBytes: scaled(reading(memory), MIB),
      name: maskCommandLineSecrets(name.join(', ').trim()).slice(0, PROCESS_NAME_MAX_CHARS),
      container: containerId
        ? {
            id: containerId,
            name: containers.find((entry) => containerId.startsWith(entry.id))?.name ?? null
          }
        : null
    })
  }
  processes.sort(
    (a, b) =>
      (a.gpuIndex ?? Infinity) - (b.gpuIndex ?? Infinity) ||
      (b.memoryBytes ?? -1) - (a.memoryBytes ?? -1) ||
      a.pid - b.pid
  )
  return { gpus, processes }
}

export async function readMachineGpus(connection: MachineConnection): Promise<MachineGpu[]> {
  const result = await runMachineHostScript(connection, MACHINE_GPU_READINGS_SCRIPT, {
    timeoutMs: READ_TIMEOUT_MS
  })
  return parseMachineGpus(result.stdout)
}

const recheckAt = new Map<MachineId, number>()

/**
 * A machine where no GPU has been seen is asked again only once a minute, so most machines pay
 * next to nothing. One that has shown a GPU is read every time, so a failed read costs one sample.
 */
async function overviewGpus(connection: MachineConnection): Promise<MachineGpu[]> {
  const { machineId } = connection
  if (!connection.isConnected() || Date.now() < (recheckAt.get(machineId) ?? 0)) {
    return []
  }
  const known = recheckAt.get(machineId) === 0
  try {
    const gpus = (await connection.dialect()) === 'posix' ? await readMachineGpus(connection) : []
    if (gpus.length > 0 || !known) {
      recheckAt.set(machineId, gpus.length > 0 ? 0 : Date.now() + NO_GPU_RECHECK_MS)
    }
    return gpus
  } catch {
    if (!known) {
      recheckAt.set(machineId, Date.now() + NO_GPU_RECHECK_MS)
    }
    return []
  }
}

/** The machine's metrics with its GPUs; a GPU read that fails never fails the metrics. */
export async function collectMachineMetricsWithGpus(
  connection: MachineConnection
): Promise<MachineMetrics> {
  const [metrics, gpus] = await Promise.all([connection.metrics(), overviewGpus(connection)])
  return gpus.length > 0 ? { ...metrics, gpus } : metrics
}
