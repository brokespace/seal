import { createHash } from 'node:crypto'
import {
  plausibleCpuTemperatureC,
  type MachineCpuTemperature,
  type MachineCpuTemperatureSensor
} from '../../../shared/machines/machine-cpu-temperature-types'
import { MACOS_CPU_TEMPERATURE_HELPER_SOURCE } from './macos-cpu-temperature-helper-source'

// A changed helper gets a new binary name, so a Mac never runs a stale build.
const HELPER_HASH = createHash('sha256')
  .update(MACOS_CPU_TEMPERATURE_HELPER_SOURCE)
  .digest('hex')
  .slice(0, 12)

/**
 * Builds the helper once with the Mac's own compiler, then runs it on every reading. `xcrun` is
 * only touched once `xcode-select -p` names a directory that is really there: with no developer
 * directory at all the /usr/bin shims open the "install developer tools" dialog. `xcrun` then finds
 * the compiler wherever that Xcode or Command Line Tools keeps it. A failed build is retried a day on.
 */
export const MACOS_CPU_TEMPERATURE_SCRIPT = `
if [ "$(uname -s)" = Darwin ]; then
  seal_cputemp_dir="$HOME/.seal/cpu-temperature"
  seal_cputemp_bin="$seal_cputemp_dir/cpu-temperature-${HELPER_HASH}"
  if [ ! -x "$seal_cputemp_bin" ] &&
    [ -z "$(find "$seal_cputemp_bin.failed" -mtime -1 2>/dev/null)" ] &&
    seal_cputemp_tools=$(xcode-select -p 2>/dev/null) &&
    [ -d "$seal_cputemp_tools" ] &&
    seal_cputemp_cc=$(xcrun --find cc 2>/dev/null) &&
    [ -x "$seal_cputemp_cc" ]; then
    (
      umask 077
      if mkdir -p "$seal_cputemp_dir" &&
        xcrun cc -x c -O1 -w -o "$seal_cputemp_bin.$$" - -framework IOKit -framework CoreFoundation <<'SEAL_CPUTEMP_C' &&
${MACOS_CPU_TEMPERATURE_HELPER_SOURCE}
SEAL_CPUTEMP_C
        mv -f "$seal_cputemp_bin.$$" "$seal_cputemp_bin"
      then
        for seal_cputemp_old in "$seal_cputemp_dir"/cpu-temperature-*; do
          [ "$seal_cputemp_old" = "$seal_cputemp_bin" ] || rm -f "$seal_cputemp_old"
        done
      else
        rm -f "$seal_cputemp_bin.$$"
        [ -x "$seal_cputemp_bin" ] || touch "$seal_cputemp_bin.failed"
      fi
    ) >/dev/null 2>&1
  fi
  if [ -x "$seal_cputemp_bin" ]; then { "$seal_cputemp_bin"; } 2>/dev/null || :; fi
fi
`

const ROW_MARK = '@mactemp\t'
const INTEL_DIE_KEYS = ['TC0D', 'TC0E', 'TC0F']

type HelperReadings = Record<'smc' | 'hid', MachineCpuTemperatureSensor[]>

function helperReadings(output: string): HelperReadings {
  const readings: HelperReadings = { smc: [], hid: [] }
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith(ROW_MARK)) {
      continue
    }
    const cells = line.slice(ROW_MARK.length).split('\t')
    const [kind, label = '', value = ''] = cells.map((cell) => cell.trim())
    if ((kind !== 'smc' && kind !== 'hid') || cells.length !== 3 || !label) {
      continue
    }
    const temperatureC = /^\d+(\.\d+)?$/.test(value)
      ? plausibleCpuTemperatureC(Number(value))
      : null
    if (temperatureC !== null && !readings[kind].some((sensor) => sensor.label === label)) {
      readings[kind].push({ label, temperatureC })
    }
  }
  return readings
}

function hottest(sensors: MachineCpuTemperatureSensor[]): MachineCpuTemperatureSensor | undefined {
  return sensors.reduce<MachineCpuTemperatureSensor | undefined>(
    (best, sensor) => (best && best.temperatureC >= sensor.temperatureC ? best : sensor),
    undefined
  )
}

/** An Intel Mac has a package sensor and die sensors; they say more than the hottest core. */
function intelPackage(
  sensors: MachineCpuTemperatureSensor[]
): MachineCpuTemperatureSensor | undefined {
  const named = (key: string): MachineCpuTemperatureSensor | undefined =>
    sensors.find((sensor) => sensor.label === key)
  return (
    named('TCXC') ??
    hottest(sensors.filter((sensor) => INTEL_DIE_KEYS.includes(sensor.label))) ??
    named('TC0P') ??
    hottest(sensors)
  )
}

/** Reads what the helper printed; Apple Silicon has no package sensor, so its hottest core stands in. */
export function parseMacosCpuTemperature(output: string): MachineCpuTemperature | null {
  const { smc, hid } = helperReadings(output)
  const sensors = smc.length > 0 ? smc : hid
  const isIntel = smc.some((sensor) => sensor.label.startsWith('TC'))
  const main = isIntel ? intelPackage(sensors) : hottest(sensors)
  if (!main) {
    return null
  }
  return {
    temperatureC: main.temperatureC,
    source: smc.length > 0 ? 'SMC' : 'HID',
    sensors: [main, ...sensors.filter((sensor) => sensor !== main)]
  }
}
