import {
  plausibleCpuTemperatureC,
  type MachineCpuTemperature,
  type MachineCpuTemperatureSensor
} from '../../../shared/machines/machine-cpu-temperature-types'

const ROW = '@cputemp\t'

/**
 * Every temperature the kernel shows an ordinary user: hwmon chips, then thermal zones. `read` is
 * a shell builtin, so a machine with a hundred sensors starts no process to read them.
 */
export const LINUX_CPU_TEMPERATURE_SCRIPT = `
if [ -d /sys/class/hwmon ] || [ -d /sys/class/thermal ]; then
  for seal_cputemp_chip in /sys/class/hwmon/hwmon*; do
    seal_cputemp_name=
    read -r seal_cputemp_name < "$seal_cputemp_chip/name" || continue
    for seal_cputemp_input in "$seal_cputemp_chip"/temp*_input; do
      seal_cputemp_label=
      seal_cputemp_value=
      read -r seal_cputemp_label < "\${seal_cputemp_input%_input}_label"
      read -r seal_cputemp_value < "$seal_cputemp_input" || continue
      seal_cputemp_sensor=\${seal_cputemp_input##*/temp}
      printf '${ROW}hwmon\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "\${seal_cputemp_chip##*/hwmon}" "$seal_cputemp_name" "\${seal_cputemp_sensor%_input}" "$seal_cputemp_label" "$seal_cputemp_value"
    done
  done
  for seal_cputemp_zone in /sys/class/thermal/thermal_zone*; do
    seal_cputemp_name=
    seal_cputemp_value=
    read -r seal_cputemp_name < "$seal_cputemp_zone/type" || continue
    read -r seal_cputemp_value < "$seal_cputemp_zone/temp" || continue
    printf '${ROW}zone\\t%s\\t%s\\t0\\t\\t%s\\n' "\${seal_cputemp_zone##*/thermal_zone}" "$seal_cputemp_name" "$seal_cputemp_value"
  done
fi 2>/dev/null
`

type Row = {
  kind: 'hwmon' | 'zone'
  /** The hwmon or thermal zone number: two processors are two devices of one driver. */
  device: number
  name: string
  sensor: number
  label: string
  temperatureC: number
}

function parseRows(output: string): Row[] {
  const rows: Row[] = []
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith(ROW)) {
      continue
    }
    const [kind, device, name, sensor, label, value] = line.slice(ROW.length).split('\t')
    const temperatureC = /^-?\d+$/.test(value ?? '')
      ? plausibleCpuTemperatureC(Number(value) / 1000)
      : null
    if ((kind !== 'hwmon' && kind !== 'zone') || temperatureC === null) {
      continue
    }
    rows.push({
      kind,
      device: Number(device),
      name: name.trim(),
      sensor: Number(sensor),
      label: label.trim(),
      temperatureC
    })
  }
  return rows.sort((a, b) => a.device - b.device || a.sensor - b.sensor)
}

function hottest(rows: readonly Row[]): Row | undefined {
  return rows.reduce<Row | undefined>(
    (best, row) => (best && best.temperatureC >= row.temperatureC ? best : row),
    undefined
  )
}

function byDevice(rows: readonly Row[]): Row[][] {
  const devices = new Map<number, Row[]>()
  for (const row of rows) {
    devices.set(row.device, [...(devices.get(row.device) ?? []), row])
  }
  return [...devices.values()]
}

/** The reading of `rows`, led by `main`; a label two processors share gets its processor's number. */
function reading(source: string, main: Row, rows: readonly Row[]): MachineCpuTemperature {
  const devices = [...new Set(rows.map((row) => row.device))]
  const labelOf = (row: Row): string => row.label || (row.kind === 'zone' ? row.name : 'CPU')
  const sensor = (row: Row): MachineCpuTemperatureSensor => {
    const label = labelOf(row)
    const shared = rows.some((other) => other !== row && labelOf(other) === label)
    return {
      label: !shared
        ? label
        : row.kind === 'zone'
          ? `${label} ${row.device}`
          : `${label} (CPU ${devices.indexOf(row.device)})`,
      temperatureC: row.temperatureC
    }
  }
  return {
    temperatureC: main.temperatureC,
    source,
    sensors: [sensor(main), ...rows.filter((row) => row !== main).map(sensor)]
  }
}

type Chip = {
  matches: (row: Row) => boolean
  source: (row: Row) => string
  /** The row that stands for one processor, or undefined to take its hottest. */
  main?: (rows: readonly Row[]) => Row | undefined
}

const labelled = (rows: readonly Row[], label: RegExp): Row | undefined =>
  rows.find((row) => label.test(row.label))

// In order of trust: the processor's own driver, then a zone named after it, then the board's.
const CHIPS: Chip[] = [
  {
    // Tctl carries an offset on some Ryzen models; Tdie, where the driver gives it, does not.
    matches: (row) => row.kind === 'hwmon' && /^(k10temp|zenpower)$/.test(row.name),
    source: (row) => row.name,
    main: (rows) => labelled(rows, /^Tdie$/) ?? labelled(rows, /^Tctl$/) ?? rows[0]
  },
  {
    matches: (row) => row.kind === 'hwmon' && row.name === 'coretemp',
    source: () => 'coretemp',
    main: (rows) => labelled(rows, /^Package id \d+$/)
  },
  {
    matches: (row) => row.kind === 'hwmon' && /cpu|soc|k8temp/i.test(row.name),
    source: (row) => row.name
  },
  {
    matches: (row) => row.kind === 'zone' && row.name === 'x86_pkg_temp',
    source: () => 'Thermal zone'
  },
  {
    matches: (row) => row.kind === 'zone' && /cpu|soc/i.test(row.name),
    source: () => 'Thermal zone'
  },
  // The hwmon chip of the same name repeats these zones.
  {
    matches: (row) => row.kind === 'zone' && row.name === 'acpitz',
    source: () => 'ACPI thermal zone'
  },
  {
    matches: (row) => row.kind === 'hwmon' && row.name === 'acpitz',
    source: () => 'ACPI thermal zone'
  }
]

/** Reads what `LINUX_CPU_TEMPERATURE_SCRIPT` printed; null where no sensor describes the processor. */
export function parseLinuxCpuTemperature(output: string): MachineCpuTemperature | null {
  const all = parseRows(output)
  for (const chip of CHIPS) {
    const rows = all.filter(chip.matches)
    const main = hottest(
      byDevice(rows).flatMap((device) => chip.main?.(device) ?? hottest(device) ?? [])
    )
    if (main) {
      return reading(chip.source(main), main, rows)
    }
  }
  return null
}
