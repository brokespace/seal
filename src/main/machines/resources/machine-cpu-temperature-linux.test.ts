import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LINUX_CPU_TEMPERATURE_SCRIPT,
  parseLinuxCpuTemperature
} from './machine-cpu-temperature-linux'

/** What the host script prints for one `temp*_input` of an hwmon chip. */
function hwmon(device: number, chip: string, sensor: number, label: string, value: number): string {
  return `@cputemp\thwmon\t${device}\t${chip}\t${sensor}\t${label}\t${value}`
}

function zone(index: number, type: string, value: number): string {
  return `@cputemp\tzone\t${index}\t${type}\t0\t\t${value}`
}

describe('Linux CPU temperature', () => {
  it('reads the die of a Ryzen whose control temperature carries an offset', () => {
    const output = [
      hwmon(0, 'nvme', 1, 'Composite', 41850),
      hwmon(1, 'amdgpu', 1, 'edge', 47000),
      hwmon(2, 'k10temp', 1, 'Tctl', 71375),
      hwmon(2, 'k10temp', 2, 'Tdie', 61375),
      hwmon(2, 'k10temp', 3, 'Tccd1', 58250),
      hwmon(2, 'k10temp', 4, 'Tccd2', 60500),
      zone(0, 'acpitz', 16800)
    ].join('\n')

    expect(parseLinuxCpuTemperature(output)).toEqual({
      temperatureC: 61.4,
      source: 'k10temp',
      sensors: [
        { label: 'Tdie', temperatureC: 61.4 },
        { label: 'Tctl', temperatureC: 71.4 },
        { label: 'Tccd1', temperatureC: 58.3 },
        { label: 'Tccd2', temperatureC: 60.5 }
      ]
    })
  })

  it('reads the hotter package of two Xeons, with each core under its processor', () => {
    const output = [
      hwmon(3, 'coretemp', 3, 'Core 1', 44000),
      hwmon(3, 'coretemp', 1, 'Package id 1', 52000),
      hwmon(3, 'coretemp', 2, 'Core 0', 51000),
      hwmon(2, 'coretemp', 1, 'Package id 0', 47000),
      hwmon(2, 'coretemp', 2, 'Core 0', 46000),
      hwmon(2, 'coretemp', 10, 'Core 8', 43000),
      zone(0, 'x86_pkg_temp', 47000)
    ].join('\r\n')

    expect(parseLinuxCpuTemperature(output)).toEqual({
      temperatureC: 52,
      source: 'coretemp',
      sensors: [
        { label: 'Package id 1', temperatureC: 52 },
        { label: 'Package id 0', temperatureC: 47 },
        { label: 'Core 0 (CPU 0)', temperatureC: 46 },
        { label: 'Core 8', temperatureC: 43 },
        { label: 'Core 0 (CPU 1)', temperatureC: 51 },
        { label: 'Core 1', temperatureC: 44 }
      ]
    })
  })

  it('reads the hottest core of an old processor that reports no package', () => {
    const output = [
      hwmon(1, 'coretemp', 2, 'Core 0', 58000),
      hwmon(1, 'coretemp', 3, 'Core 1', 63000)
    ].join('\n')

    expect(parseLinuxCpuTemperature(output)).toMatchObject({
      temperatureC: 63,
      sensors: [{ label: 'Core 1' }, { label: 'Core 0' }]
    })
  })

  it('prefers the package zone to the board’s ACPI zone where no driver reports', () => {
    const output = [zone(0, 'acpitz', 27800), zone(1, 'x86_pkg_temp', 54000)].join('\n')

    expect(parseLinuxCpuTemperature(output)).toEqual({
      temperatureC: 54,
      source: 'Thermal zone',
      sensors: [{ label: 'x86_pkg_temp', temperatureC: 54 }]
    })
  })

  it('falls back to the ACPI zones, once each', () => {
    const output = [
      hwmon(0, 'acpitz', 1, '', 48000),
      hwmon(0, 'acpitz', 2, '', 39000),
      zone(0, 'acpitz', 48000),
      zone(1, 'acpitz', 39000)
    ].join('\n')

    expect(parseLinuxCpuTemperature(output)).toEqual({
      temperatureC: 48,
      source: 'ACPI thermal zone',
      sensors: [
        { label: 'acpitz 0', temperatureC: 48 },
        { label: 'acpitz 1', temperatureC: 39 }
      ]
    })
  })

  it('reports nothing for a virtual machine, a disk’s sensor or a broken reading', () => {
    expect(parseLinuxCpuTemperature('@os Linux\n')).toBeNull()
    expect(parseLinuxCpuTemperature(hwmon(0, 'nvme', 1, 'Composite', 41850))).toBeNull()
    expect(
      parseLinuxCpuTemperature(
        [hwmon(2, 'k10temp', 1, 'Tctl', 0), hwmon(1, 'coretemp', 1, 'Package id 0', -40000)].join(
          '\n'
        )
      )
    ).toBeNull()
    expect(parseLinuxCpuTemperature('@cputemp\thwmon\t2\tk10temp\t1\tTctl\tN/A')).toBeNull()
  })

  it.skipIf(process.platform !== 'linux')(
    'reads a sysfs tree with the script the host runs',
    () => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'seal-sysfs-'))
      const file = (name: string, text: string): void => {
        mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
        writeFileSync(path.join(root, name), `${text}\n`)
      }
      try {
        file('hwmon/hwmon0/name', 'nvme')
        file('hwmon/hwmon0/temp1_input', '38850')
        file('hwmon/hwmon0/temp1_label', 'Composite')
        file('hwmon/hwmon4/name', 'coretemp')
        file('hwmon/hwmon4/temp1_input', '67000')
        file('hwmon/hwmon4/temp1_label', 'Package id 0')
        file('hwmon/hwmon4/temp2_input', '65000')
        file('hwmon/hwmon4/temp2_label', 'Core 0')
        file('hwmon/hwmon4/temp10_input', '61000')
        file('hwmon/hwmon4/temp10_label', 'Core 8')
        // A fan-only chip, and a sensor whose label file is missing.
        file('hwmon/hwmon5/name', 'dell_smm')
        file('hwmon/hwmon6/name', 'k10temp')
        file('hwmon/hwmon6/temp1_input', '33000')
        file('thermal/thermal_zone0/type', 'acpitz')
        file('thermal/thermal_zone0/temp', '27800')
        file('thermal/cooling_device0/type', 'Processor')
        const script = LINUX_CPU_TEMPERATURE_SCRIPT.replaceAll('/sys/class', root)

        const output = execFileSync('/bin/sh', ['-c', script], {
          encoding: 'utf8',
          env: { ...process.env, LC_ALL: 'C' }
        })

        expect(output.split('\n').filter(Boolean)).toEqual([
          '@cputemp\thwmon\t0\tnvme\t1\tComposite\t38850',
          '@cputemp\thwmon\t4\tcoretemp\t10\tCore 8\t61000',
          '@cputemp\thwmon\t4\tcoretemp\t1\tPackage id 0\t67000',
          '@cputemp\thwmon\t4\tcoretemp\t2\tCore 0\t65000',
          '@cputemp\thwmon\t6\tk10temp\t1\t\t33000',
          '@cputemp\tzone\t0\tacpitz\t0\t\t27800'
        ])
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )
})
