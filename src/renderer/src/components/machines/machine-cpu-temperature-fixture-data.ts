import type {
  MachineCpuTemperature,
  MachineCpuTemperatureSensor
} from '../../../../shared/machines/machine-cpu-temperature-types'

function sensor(label: string, temperatureC: number): MachineCpuTemperatureSensor {
  return { label, temperatureC }
}

/** A 24-core Xeon as `coretemp` reports it: the package, then each core. */
export const XEON_CORETEMP: MachineCpuTemperature = {
  temperatureC: 67,
  source: 'coretemp',
  sensors: [
    sensor('Package id 0', 67),
    ...Array.from({ length: 24 }, (_, core) => sensor(`Core ${core}`, 52 + ((core * 7) % 15)))
  ]
}

/** A Threadripper as `k10temp` reports it: the control temperature and each die. */
export const THREADRIPPER_K10TEMP: MachineCpuTemperature = {
  temperatureC: 71.4,
  source: 'k10temp',
  sensors: [
    sensor('Tctl', 71.4),
    sensor('Tccd1', 66.5),
    sensor('Tccd3', 69.8),
    sensor('Tccd5', 64.3),
    sensor('Tccd7', 68)
  ]
}

/** An Apple Silicon MacBook: its hottest core sensor leads. */
export const APPLE_SMC: MachineCpuTemperature = {
  temperatureC: 48.6,
  source: 'SMC',
  sensors: [
    sensor('Tp0D', 48.6),
    sensor('Tp01', 46.2),
    sensor('Tp05', 47.9),
    sensor('Tp09', 44.1),
    sensor('Tp0T', 43.8)
  ]
}

/** A Windows desktop with LibreHardwareMonitor running. */
export const RYZEN_LIBRE_HARDWARE_MONITOR: MachineCpuTemperature = {
  temperatureC: 58.9,
  source: 'LibreHardwareMonitor',
  sensors: [sensor('Core (Tctl/Tdie)', 58.9)]
}
