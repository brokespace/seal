import { describe, expect, it } from 'vitest'
import { parseMacosCpuTemperature } from './machine-cpu-temperature-macos'

describe('macOS CPU temperature', () => {
  it('reports the hottest core of an Apple Silicon Mac among the other host script lines', () => {
    const output = [
      '@apple\t"model" = "Apple M2 Pro"',
      '@mactemp\tsmc\tTp1h\t48.3',
      '@mactemp\tsmc\tTp1t\t51.9',
      '@mactemp\tsmc\tTp0D\t55.2',
      '@mactemp\tsmc\tTp0j\t49.0',
      ''
    ].join('\n')

    expect(parseMacosCpuTemperature(output)).toEqual({
      temperatureC: 55.2,
      source: 'SMC',
      sensors: [
        { label: 'Tp0D', temperatureC: 55.2 },
        { label: 'Tp1h', temperatureC: 48.3 },
        { label: 'Tp1t', temperatureC: 51.9 },
        { label: 'Tp0j', temperatureC: 49 }
      ]
    })
  })

  it('falls back to the HID core sensors where the SMC gave nothing', () => {
    const output = [
      'Last login: Mon Nov 16 09:12:44 2026',
      '@mactemp\thid\tpACC MTR Temp Sensor0\t41.2',
      '@mactemp\thid\teACC MTR Temp Sensor3\t44.7',
      '@mactemp\thid\tpACC MTR Temp Sensor0\t99.0',
      '@mactemp\thid\tpACC MTR Temp Sensor7\t38.9',
      ''
    ].join('\r\n')

    expect(parseMacosCpuTemperature(output)).toEqual({
      temperatureC: 44.7,
      source: 'HID',
      sensors: [
        { label: 'eACC MTR Temp Sensor3', temperatureC: 44.7 },
        { label: 'pACC MTR Temp Sensor0', temperatureC: 41.2 },
        { label: 'pACC MTR Temp Sensor7', temperatureC: 38.9 }
      ]
    })
  })

  it('reports the package sensor of an Intel Mac even when a core runs hotter', () => {
    const output = [
      '@mactemp\tsmc\tTC0P\t52.3',
      '@mactemp\tsmc\tTCXC\t64.0',
      '@mactemp\tsmc\tTC1C\t66.5',
      '@mactemp\tsmc\tTC2C\t61.0'
    ].join('\n')

    expect(parseMacosCpuTemperature(output)).toEqual({
      temperatureC: 64,
      source: 'SMC',
      sensors: [
        { label: 'TCXC', temperatureC: 64 },
        { label: 'TC0P', temperatureC: 52.3 },
        { label: 'TC1C', temperatureC: 66.5 },
        { label: 'TC2C', temperatureC: 61 }
      ]
    })
  })

  it('reports the hottest die sensor of an Intel Mac that has no package sensor', () => {
    const output = [
      '@mactemp\tsmc\tTC0P\t52.3',
      '@mactemp\tsmc\tTC0D\t61.0',
      '@mactemp\tsmc\tTC0E\t63.5',
      '@mactemp\tsmc\tTC1C\t66.5'
    ].join('\n')

    expect(parseMacosCpuTemperature(output)).toMatchObject({
      temperatureC: 63.5,
      sensors: [{ label: 'TC0E' }, { label: 'TC0P' }, { label: 'TC0D' }, { label: 'TC1C' }]
    })
  })

  it('reports nothing when no sensor gave a believable figure', () => {
    const output = [
      '@apple\t"model" = "Apple M1"',
      '@mactemp\tsmc\tTp09\t0.0',
      '@mactemp\tsmc\tTp0T\t-12.5',
      '@mactemp\tsmc\tTp01\t250.4',
      '@mactemp\tsmc\tTp05\tnan',
      '@mactemp\tsmc\tTp0D',
      '@mactemp\thid\t\t41.2'
    ].join('\n')

    expect(parseMacosCpuTemperature(output)).toBeNull()
    expect(parseMacosCpuTemperature('')).toBeNull()
  })
})
