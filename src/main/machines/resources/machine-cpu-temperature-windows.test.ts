import { describe, expect, it } from 'vitest'
import { parseWindowsCpuTemperature } from './machine-cpu-temperature-windows'

describe('Windows CPU temperature', () => {
  it('reads the package of an Intel desktop from LibreHardwareMonitor, amid profile noise', () => {
    const output = [
      'Welcome to the GPU lab',
      String.raw`SEAL_CPU_TEMP {"source":"lhm","rows":[{"n":"CPU Core #1","v":48.0,"i":"/intelcpu/0/temperature/0"},{"n":"CPU Core #2","v":51.0,"i":"/intelcpu/0/temperature/1"},{"n":"CPU Package","v":53.0,"i":"/intelcpu/0/temperature/2"},{"n":"CPU Core #1 Distance to TjMax","v":52.0,"i":"/intelcpu/0/temperature/3"},{"n":"CPU Core #2 Distance to TjMax","v":49.0,"i":"/intelcpu/0/temperature/4"},{"n":"Core Max","v":51.0,"i":"/intelcpu/0/temperature/5"},{"n":"Core Average","v":49.5,"i":"/intelcpu/0/temperature/6"}]}`,
      ''
    ].join('\r\n')

    expect(parseWindowsCpuTemperature(output)).toEqual({
      temperatureC: 53,
      source: 'LibreHardwareMonitor',
      sensors: [
        { label: 'CPU Package', temperatureC: 53 },
        { label: 'CPU Core #1', temperatureC: 48 },
        { label: 'CPU Core #2', temperatureC: 51 },
        { label: 'Core Max', temperatureC: 51 },
        { label: 'Core Average', temperatureC: 49.5 }
      ]
    })
  })

  it('reads the die of a Ryzen rather than its hottest chiplet', () => {
    const output = String.raw`SEAL_CPU_TEMP {"source":"lhm","rows":[{"n":"CCD1 (Tdie)","v":58.3,"i":"/amdcpu/0/temperature/3"},{"n":"CCD2 (Tdie)","v":63.5,"i":"/amdcpu/0/temperature/4"},{"n":"Core (Tctl/Tdie)","v":61.6,"i":"/amdcpu/0/temperature/2"},{"n":"CCDs Max (Tdie)","v":63.5,"i":"/amdcpu/0/temperature/5"}]}`

    expect(parseWindowsCpuTemperature(output)).toEqual({
      temperatureC: 61.6,
      source: 'LibreHardwareMonitor',
      sensors: [
        { label: 'Core (Tctl/Tdie)', temperatureC: 61.6 },
        { label: 'CCD1 (Tdie)', temperatureC: 58.3 },
        { label: 'CCD2 (Tdie)', temperatureC: 63.5 },
        { label: 'CCDs Max (Tdie)', temperatureC: 63.5 }
      ]
    })
  })

  it('reads the text LibreHardwareMonitor’s web server shows, decimal comma or Fahrenheit', () => {
    const output = String.raw`SEAL_CPU_TEMP {"source":"web","rows":[{"n":"Core (Tctl/Tdie)","t":"61,6 C","i":"/amdcpu/0/temperature/2"},{"n":"CCD1 (Tdie)","t":"58.3 C","i":"/amdcpu/0/temperature/3"},{"n":"CCD2 (Tdie)","t":"146.3 F","i":"/amdcpu/0/temperature/4"},{"n":"Core (Tctl/Tdie)","t":"","i":"/amdcpu/0/temperature/9"}]}`

    expect(parseWindowsCpuTemperature(output)).toEqual({
      temperatureC: 61.6,
      source: 'LibreHardwareMonitor',
      sensors: [
        { label: 'Core (Tctl/Tdie)', temperatureC: 61.6 },
        { label: 'CCD1 (Tdie)', temperatureC: 58.3 },
        { label: 'CCD2 (Tdie)', temperatureC: 63.5 }
      ]
    })
  })

  it('reports the hotter of two processors and says which one each sensor is on', () => {
    const output = String.raw`SEAL_CPU_TEMP {"source":"ohm","rows":[{"n":"CPU Core #1","v":44.0,"i":"/intelcpu/0/temperature/0"},{"n":"CPU Package","v":47.0,"i":"/intelcpu/0/temperature/1"},{"n":"CPU Core #1","v":52.0,"i":"/intelcpu/1/temperature/0"},{"n":"CPU Package","v":55.0,"i":"/intelcpu/1/temperature/1"}]}`

    expect(parseWindowsCpuTemperature(output)).toEqual({
      temperatureC: 55,
      source: 'OpenHardwareMonitor',
      sensors: [
        { label: 'CPU Package (CPU 1)', temperatureC: 55 },
        { label: 'CPU Core #1 (CPU 0)', temperatureC: 44 },
        { label: 'CPU Package (CPU 0)', temperatureC: 47 },
        { label: 'CPU Core #1 (CPU 1)', temperatureC: 52 }
      ]
    })
  })

  it('converts ACPI thermal zones from tenths of a Kelvin and leads with the hottest', () => {
    const output = String.raw`SEAL_CPU_TEMP {"source":"acpi","rows":[{"n":"ACPI\\ThermalZone\\TZ00_0","v":3012.0},{"n":"ACPI\\ThermalZone\\TZ01_0","v":3217.0}]}`

    expect(parseWindowsCpuTemperature(output)).toEqual({
      temperatureC: 48.5,
      source: 'ACPI thermal zone',
      sensors: [
        { label: 'TZ01', temperatureC: 48.5 },
        { label: 'TZ00', temperatureC: 28 }
      ]
    })
  })

  it('reads the thermal zone performance counter', () => {
    const output = String.raw`SEAL_CPU_TEMP {"source":"zone","rows":[{"n":"\\_TZ.THM0","v":3172.0}]}`

    expect(parseWindowsCpuTemperature(output)).toEqual({
      temperatureC: 44,
      source: 'Thermal zone',
      sensors: [{ label: 'THM0', temperatureC: 44 }]
    })
  })

  it('reports nothing rather than a reading no sensor made', () => {
    const noSource = 'SEAL_CPU_TEMP {"source":"none","rows":[]}'
    const stubZone = String.raw`SEAL_CPU_TEMP {"source":"zone","rows":[{"n":"\\_TZ.TZ00","v":2732.0}]}`
    const deadSensors = String.raw`SEAL_CPU_TEMP {"source":"lhm","rows":[{"n":"CPU Package","v":-55.0,"i":"/intelcpu/0/temperature/0"},{"n":"CPU Core #1 Distance to TjMax","v":40.0,"i":"/intelcpu/0/temperature/1"},{"n":"GPU Core","v":61.0,"i":"/gpu-nvidia/0/temperature/0"}]}`

    expect(parseWindowsCpuTemperature(noSource)).toBeNull()
    expect(parseWindowsCpuTemperature(stubZone)).toBeNull()
    expect(parseWindowsCpuTemperature(deadSensors)).toBeNull()
    expect(parseWindowsCpuTemperature("'powershell.exe' is not recognized")).toBeNull()
    expect(parseWindowsCpuTemperature('SEAL_CPU_TEMP {"source":"lhm","rows":[{"n":')).toBeNull()
  })
})
