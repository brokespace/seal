export type MachineCpuTemperatureSensor = {
  /** What the driver calls it: `Tctl`, `Package id 0`, `Core 3`, `CPU Package`. */
  label: string
  temperatureC: number
}

export type MachineCpuTemperature = {
  /** The package or die reading; the hottest core where the processor reports neither. */
  temperatureC: number
  /** The driver or service it was read from: `k10temp`, `coretemp`, `SMC`, `LibreHardwareMonitor`. */
  source: string
  /** Every reading of that source. The first is the one `temperatureC` came from. */
  sensors: MachineCpuTemperatureSensor[]
}

/** A sensor that is absent or broken reads zero, a negative or an absurd figure. */
export function plausibleCpuTemperatureC(value: number): number | null {
  return Number.isFinite(value) && value > 0 && value < 150 ? Math.round(value * 10) / 10 : null
}
