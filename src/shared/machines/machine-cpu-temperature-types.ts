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

/** Where the temperature monitor Seal sets up on a Windows machine stands. */
export type MachineCpuTemperatureSetupState = 'not-set-up' | 'running' | 'stopped' | 'failed'

/**
 * How setup gets administrator rights over this connection: Windows asks on the machine's screen,
 * the connection already holds them, the account has none to give, or there is no screen to ask on.
 */
export type MachineCpuTemperatureSetupElevation =
  | 'prompt'
  | 'elevated'
  | 'needs-admin'
  | 'no-desktop'

export type MachineCpuTemperatureSetup = {
  state: MachineCpuTemperatureSetupState
  /** The machine's own account of a failure, or of what is left to do. */
  message: string | null
  elevation: MachineCpuTemperatureSetupElevation
  /** The Windows account the monitor starts for. */
  account: string
}

export const MACHINE_CPU_TEMPERATURE_SETUP_ACTIONS = ['install', 'remove'] as const
export type MachineCpuTemperatureSetupAction =
  (typeof MACHINE_CPU_TEMPERATURE_SETUP_ACTIONS)[number]

export type MachineCpuTemperatureSetupResult = {
  /** `declined`: the Windows prompt was refused. `blocked`: this connection cannot ask for it. */
  outcome: 'done' | 'declined' | 'blocked' | 'failed'
  /** Why Windows did not run the setup, where the outcome is `failed`. */
  detail: string | null
  setup: MachineCpuTemperatureSetup
}
