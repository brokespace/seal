import {
  plausibleCpuTemperatureC,
  type MachineCpuTemperature,
  type MachineCpuTemperatureSensor
} from '../../../shared/machines/machine-cpu-temperature-types'

const CPU_TEMPERATURE_MARKER = 'SEAL_CPU_TEMP '

/** Where the LibreHardwareMonitor that Seal sets up answers; 8085 is the port a user's own copy defaults to. */
export const SEAL_LIBRE_HARDWARE_MONITOR_PORT = 18085

/**
 * Asks the sources an ordinary user can read, best first, and prints the first that has a reading:
 * `SEAL_CPU_TEMP {"source":"lhm"|"web"|"ohm"|"acpi"|"zone"|"none","rows":[{"n":name,"v":number,"t":text,"i":identifier}]}`.
 * `v` is degrees Celsius for lhm/ohm and tenths of a Kelvin for acpi/zone; `web` rows carry the text
 * LibreHardwareMonitor's web server shows instead; only lhm/web/ohm rows carry `i`.
 * LibreHardwareMonitor publishes to WMI up to 0.9.4 and only over its web server from 0.9.5 on.
 * Rows are serialized one by one and joined, so no array has to survive ConvertTo-Json in PowerShell 5.1.
 */
export const WINDOWS_CPU_TEMPERATURE_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  `$sensors = "SensorType='Temperature'"`,
  "$cpu = '^/(intelcpu|amdcpu|genericcpu|cpu)/'",
  '$queries = [ordered]@{',
  "  lhm = @{ Namespace = 'root/LibreHardwareMonitor'; ClassName = 'Sensor'; Filter = $sensors }",
  `  web = @{ Ports = ${SEAL_LIBRE_HARDWARE_MONITOR_PORT}, 8085 }`,
  "  ohm = @{ Namespace = 'root/OpenHardwareMonitor'; ClassName = 'Sensor'; Filter = $sensors }",
  "  acpi = @{ Namespace = 'root/wmi'; ClassName = 'MSAcpi_ThermalZoneTemperature' }",
  "  zone = @{ ClassName = 'Win32_PerfFormattedData_Counters_ThermalZoneInformation' }",
  '}',
  "$source = 'none'",
  '$rows = @()',
  'foreach ($name in $queries.Keys) {',
  '  $query = $queries[$name]',
  '  $found = $null',
  // A refused connection costs seconds on Windows, so the web server is only asked while the monitor runs.
  "  if ($name -eq 'web' -and (Get-Process -Name LibreHardwareMonitor)) {",
  '    foreach ($port in $query.Ports) {',
  '      $nodes = @()',
  '      try { $nodes = @(Invoke-RestMethod -Uri "http://127.0.0.1:$port/data.json" -TimeoutSec 2 -UseBasicParsing) } catch { $nodes = @() }',
  '      $rows = @(while ($nodes.Count -gt 0) {',
  '        $below = @()',
  '        foreach ($node in $nodes) {',
  "          if ($node.Type -eq 'Temperature' -and $node.SensorId -match $cpu) {",
  '            $t = $node.RawValue',
  '            if (-not $t) { $t = $node.Value }',
  // Windows PowerShell reads the degree sign of the UTF-8 reply as two Latin-1 characters.
  "            [ordered]@{ n = [string]$node.Text; t = ([string]$t -replace '[^ -~]', ''); i = [string]$node.SensorId } | ConvertTo-Json -Compress",
  '          }',
  '          if ($node.Children) { $below += $node.Children }',
  '        }',
  '        $nodes = $below',
  '      })',
  '      if ($rows.Count -gt 0) { break }',
  '    }',
  '  }',
  "  if ($name -ne 'web') {",
  '    try { $found = Get-CimInstance @query } catch { $found = $null }',
  '    $rows = @(foreach ($r in $found) {',
  '      $n = $r.Name; $v = $r.Value; $i = $r.Identifier',
  "      if ($name -eq 'acpi') { $n = $r.InstanceName; $v = $r.CurrentTemperature }",
  "      if ($name -eq 'zone') {",
  '        $v = $r.HighPrecisionTemperature',
  '        if (-not $v) { $v = 10 * $r.Temperature }',
  '      }',
  '      $v = $v -as [double]',
  "      $wanted = $query.ClassName -ne 'Sensor' -or $i -match $cpu",
  '      if ($v -gt 0 -and $wanted) {',
  '        $row = [ordered]@{ n = [string]$n; v = $v }',
  '        if ($i) { $row.i = [string]$i }',
  '        $row | ConvertTo-Json -Compress',
  '      }',
  '    })',
  '  }',
  '  if ($rows.Count -gt 0) { $source = $name; break }',
  '}',
  `Write-Output ('${CPU_TEMPERATURE_MARKER}{"source":"' + $source + '","rows":[' + ($rows -join ',') + ']}')`
].join('\n')

type Row = { name: string; value: number; identifier: string }
type ProcessorReading = MachineCpuTemperatureSensor & { processor: string }

const CPU_IDENTIFIER = /^\/(?:intelcpu|amdcpu|genericcpu|cpu)\/(\d+)\//i

function isFields(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `61.6 °C` as the web server writes it: a decimal comma in some locales, °F where the user chose it. */
function celsiusFromText(text: string): number | null {
  const match = text.match(/(-?\d+(?:[.,]\d+)?)\s*([CF])?/i)
  if (!match) {
    return null
  }
  const value = Number(match[1].replace(',', '.'))
  return match[2]?.toUpperCase() === 'F' ? ((value - 32) * 5) / 9 : value
}

function readRows(value: unknown): Row[] {
  const entries: unknown[] = Array.isArray(value) ? value : []
  const rows: Row[] = []
  for (const entry of entries) {
    if (!isFields(entry) || typeof entry.n !== 'string') {
      continue
    }
    const value = typeof entry.t === 'string' ? celsiusFromText(entry.t) : entry.v
    if (typeof value === 'number') {
      const identifier = typeof entry.i === 'string' ? entry.i : ''
      rows.push({ name: entry.n.trim(), value, identifier })
    }
  }
  return rows
}

function hottest<T extends MachineCpuTemperatureSensor>(readings: T[]): T | undefined {
  let best: T | undefined
  for (const reading of readings) {
    if (!best || reading.temperatureC > best.temperatureC) {
      best = reading
    }
  }
  return best
}

function mainReadingFirst(
  source: string,
  sensors: MachineCpuTemperatureSensor[],
  mainIndex: number
): MachineCpuTemperature | null {
  const main = sensors[mainIndex]
  if (!main) {
    return null
  }
  return {
    temperatureC: main.temperatureC,
    source,
    sensors: [main, ...sensors.filter((_, index) => index !== mainIndex)]
  }
}

function processorMainReading(readings: ProcessorReading[]): ProcessorReading | undefined {
  const named = (label: string): ProcessorReading | undefined =>
    readings.find((reading) => reading.label === label)
  const die = readings.filter((reading) => /^Core \(T(?:ctl|die)/.test(reading.label))
  return (
    named('CPU Package') ??
    // Tctl carries a fan-control offset on some Ryzens; Tdie is the real die temperature.
    die.find((reading) => reading.label.includes('Tdie')) ??
    die[0] ??
    named('Core Max') ??
    hottest(readings.filter((reading) => /^CPU Core #\d+$/.test(reading.label))) ??
    hottest(readings.filter((reading) => !/Average/i.test(reading.label))) ??
    hottest(readings)
  )
}

function hardwareMonitorTemperature(source: string, rows: Row[]): MachineCpuTemperature | null {
  const readings: ProcessorReading[] = []
  for (const row of rows) {
    const processor = row.identifier.match(CPU_IDENTIFIER)?.[1]
    const temperatureC = plausibleCpuTemperatureC(row.value)
    // "Distance to TjMax" is the margin left before throttling, not a temperature.
    if (processor && temperatureC !== null && !/Distance to TjMax/i.test(row.name)) {
      readings.push({ label: row.name, temperatureC, processor })
    }
  }
  const processors = [...new Set(readings.map((reading) => reading.processor))]
  const main = hottest(
    processors.flatMap(
      (processor) =>
        processorMainReading(readings.filter((reading) => reading.processor === processor)) ?? []
    )
  )
  const sensors = readings.map(({ label, temperatureC, processor }) => {
    const shared = readings.some((other) => other.label === label && other.processor !== processor)
    return { label: shared ? `${label} (CPU ${processor})` : label, temperatureC }
  })
  return mainReadingFirst(source, sensors, main ? readings.indexOf(main) : -1)
}

/** `ACPI\ThermalZone\TZ00_0` and `\_TZ.TZ00` both name the zone `TZ00`. */
function thermalZoneLabel(name: string): string {
  const zone = name.split(/[\\.]/).pop() ?? ''
  return zone.replace(/_\d+$/, '').replace(/_+$/, '') || name
}

function thermalZoneTemperature(source: string, rows: Row[]): MachineCpuTemperature | null {
  const sensors: MachineCpuTemperatureSensor[] = []
  for (const row of rows) {
    // Firmware writes 0 °C as 2732, so that offset reads a stub zone as zero, not as 0.05 °C.
    const temperatureC = plausibleCpuTemperatureC((row.value - 2732) / 10)
    if (temperatureC !== null) {
      sensors.push({ label: thermalZoneLabel(row.name), temperatureC })
    }
  }
  const main = hottest(sensors)
  return mainReadingFirst(source, sensors, main ? sensors.indexOf(main) : -1)
}

/** Reads the marked JSON line, ignoring any banner or profile noise around it; null when no source had a reading. */
export function parseWindowsCpuTemperature(output: string): MachineCpuTemperature | null {
  const line = output.split(/\r?\n/).find((candidate) => candidate.includes(CPU_TEMPERATURE_MARKER))
  if (!line) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(
      line.slice(line.indexOf(CPU_TEMPERATURE_MARKER) + CPU_TEMPERATURE_MARKER.length)
    )
  } catch {
    return null
  }
  if (!isFields(parsed)) {
    return null
  }
  const rows = readRows(parsed.rows)
  switch (parsed.source) {
    case 'lhm':
    case 'web':
      return hardwareMonitorTemperature('LibreHardwareMonitor', rows)
    case 'ohm':
      return hardwareMonitorTemperature('OpenHardwareMonitor', rows)
    case 'acpi':
      return thermalZoneTemperature('ACPI thermal zone', rows)
    case 'zone':
      return thermalZoneTemperature('Thermal zone', rows)
    default:
      return null
  }
}
