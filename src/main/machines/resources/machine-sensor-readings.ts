import type { MachineCpuTemperature } from '../../../shared/machines/machine-cpu-temperature-types'
import type { MachineGpu } from '../../../shared/machines/machine-gpu-types'
import type { MachineId, MachineMetrics } from '../../../shared/machines/machine-types'
import type { MachineConnection } from '../connection/machine-connection'
import {
  LINUX_CPU_TEMPERATURE_SCRIPT,
  parseLinuxCpuTemperature
} from './machine-cpu-temperature-linux'
import {
  MACOS_CPU_TEMPERATURE_SCRIPT,
  parseMacosCpuTemperature
} from './machine-cpu-temperature-macos'
import {
  parseWindowsCpuTemperature,
  WINDOWS_CPU_TEMPERATURE_SCRIPT
} from './machine-cpu-temperature-windows'
import { MACHINE_GPU_READINGS_SCRIPT } from './machine-gpu-host-scripts'
import { parseMachineGpus } from './machine-gpu-readings'
import { runMachineHostScript } from './machine-host-script'

const READ_TIMEOUT_MS = 20_000
const NO_SENSOR_RECHECK_MS = 60_000
/** How long a machine's metrics wait for its sensors before going out with the previous readings. */
const OVERVIEW_WAIT_MS = 2_000
const MACOS_MARK = '@os Darwin'
const OS_SCRIPT = '\necho "@os $(uname -s)"\n'

/** What a machine reports beyond its own metrics call: its GPUs and its processor's temperature. */
type MachineSensors = { gpus: MachineGpu[]; cpuTemperature: MachineCpuTemperature | null }

type SensorState = {
  latest: MachineSensors
  reading: Promise<void> | null
  /** Zero once the machine has shown a sensor: it is then read every time. */
  recheckAt: number
  /** Learned from the first read: only a Mac is sent the helper that reads a Mac's sensors. */
  macos: boolean
}

const NO_SENSORS: MachineSensors = { gpus: [], cpuTemperature: null }
const stateByMachine = new Map<MachineId, SensorState>()

async function readPosixSensors(
  connection: MachineConnection,
  state: SensorState
): Promise<MachineSensors> {
  const read = async (macos: boolean): Promise<string> => {
    const cpuScript = macos ? MACOS_CPU_TEMPERATURE_SCRIPT : LINUX_CPU_TEMPERATURE_SCRIPT
    const result = await runMachineHostScript(
      connection,
      `${MACHINE_GPU_READINGS_SCRIPT}${cpuScript}${OS_SCRIPT}`,
      { timeoutMs: READ_TIMEOUT_MS }
    )
    return result.stdout
  }
  let output = await read(state.macos)
  const macos = output.split(/\r?\n/).includes(MACOS_MARK)
  if (macos !== state.macos) {
    state.macos = macos
    output = await read(macos)
  }
  return {
    gpus: parseMachineGpus(output),
    cpuTemperature: macos ? parseMacosCpuTemperature(output) : parseLinuxCpuTemperature(output)
  }
}

async function readWindowsSensors(connection: MachineConnection): Promise<MachineSensors> {
  const result = await connection.exec(WINDOWS_CPU_TEMPERATURE_SCRIPT, {
    timeoutMs: READ_TIMEOUT_MS
  })
  return { gpus: [], cpuTemperature: parseWindowsCpuTemperature(result.stdout) }
}

async function readSensors(connection: MachineConnection, state: SensorState): Promise<void> {
  const seenBefore = state.recheckAt === 0
  try {
    state.latest =
      (await connection.dialect()) === 'posix'
        ? await readPosixSensors(connection, state)
        : await readWindowsSensors(connection)
  } catch {
    state.latest = NO_SENSORS
  }
  const found = state.latest.gpus.length > 0 || state.latest.cpuTemperature !== null
  // A machine where no sensor has been seen is asked again only once a minute, so it pays next to nothing.
  state.recheckAt = found || seenBefore ? 0 : Date.now() + NO_SENSOR_RECHECK_MS
  state.reading = null
}

/**
 * The sensors for a machine's overview. A read that is slow hands back the previous readings and
 * finishes on its own, so a driver that hangs holds up the machine's other metrics only briefly.
 */
async function overviewSensors(connection: MachineConnection): Promise<MachineSensors> {
  if (!connection.isConnected()) {
    return NO_SENSORS
  }
  const { machineId } = connection
  const state = stateByMachine.get(machineId) ?? {
    latest: NO_SENSORS,
    reading: null,
    recheckAt: -1,
    macos: false
  }
  stateByMachine.set(machineId, state)
  if (!state.reading && Date.now() >= state.recheckAt) {
    state.reading = readSensors(connection, state)
  }
  if (state.reading) {
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      state.reading,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, OVERVIEW_WAIT_MS)
      })
    ])
    clearTimeout(timer)
  }
  return state.latest
}

/** The machine's metrics with its sensors; a sensor read that fails never fails the metrics. */
export async function collectMachineMetricsWithSensors(
  connection: MachineConnection
): Promise<MachineMetrics> {
  const [metrics, sensors] = await Promise.all([connection.metrics(), overviewSensors(connection)])
  return {
    ...metrics,
    ...(sensors.gpus.length > 0 ? { gpus: sensors.gpus } : {}),
    ...(sensors.cpuTemperature ? { cpuTemperature: sensors.cpuTemperature } : {})
  }
}
