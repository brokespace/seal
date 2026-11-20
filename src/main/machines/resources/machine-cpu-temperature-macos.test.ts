import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MACOS_CPU_TEMPERATURE_SCRIPT,
  parseMacosCpuTemperature
} from './machine-cpu-temperature-macos'

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

/** A Mac as the script sees it: stand-ins for uname, xcode-select, xcrun and the /usr/bin/cc shim. */
describe.skipIf(process.platform === 'win32')('macOS CPU temperature helper build', () => {
  let root: string
  let log: string

  const tool = (file: string, body: string): string => {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    return file
  }
  const compiler = (file: string): string =>
    tool(
      file,
      [
        'echo "compile" >> "$SEAL_TEST_LOG"',
        'while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done',
        'cat > /dev/null',
        `printf '#!/bin/sh\\nprintf "@mactemp\\\\tsmc\\\\tTp0X\\\\t61.2\\\\n"\\n' > "$out"`,
        'chmod +x "$out"'
      ].join('\n')
    )
  const read = (developerDir: string, compilerPath: string): string =>
    execFileSync('/bin/sh', ['-c', MACOS_CPU_TEMPERATURE_SCRIPT], {
      encoding: 'utf8',
      env: {
        PATH: `${path.join(root, 'bin')}:/usr/bin:/bin`,
        HOME: path.join(root, 'home'),
        SEAL_TEST_LOG: log,
        SEAL_TEST_DEVELOPER_DIR: developerDir,
        SEAL_TEST_CC: compilerPath
      }
    })
  const calls = (): string[] =>
    existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []
  const helperFiles = (): string[] => {
    const dir = path.join(root, 'home/.seal/cpu-temperature')
    return existsSync(dir) ? execFileSync('ls', [dir], { encoding: 'utf8' }).split('\n') : []
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'seal-mactemp-'))
    log = path.join(root, 'calls.log')
    mkdirSync(path.join(root, 'home'))
    tool(path.join(root, 'bin/uname'), 'echo Darwin')
    tool(
      path.join(root, 'bin/xcode-select'),
      [
        'echo "xcode-select $*" >> "$SEAL_TEST_LOG"',
        'if [ -z "$SEAL_TEST_DEVELOPER_DIR" ]; then',
        '  echo "xcode-select: error: unable to get active developer directory" >&2',
        '  exit 2',
        'fi',
        'echo "$SEAL_TEST_DEVELOPER_DIR"'
      ].join('\n')
    )
    tool(
      path.join(root, 'bin/xcrun'),
      [
        'echo "xcrun $1 $2" >> "$SEAL_TEST_LOG"',
        'if [ ! -x "$SEAL_TEST_CC" ]; then',
        '  echo "xcrun: error: unable to find utility \\"cc\\", not a developer tool or in PATH" >&2',
        '  exit 72',
        'fi',
        'if [ "$1" = --find ]; then echo "$SEAL_TEST_CC"; exit 0; fi',
        'shift',
        'exec "$SEAL_TEST_CC" "$@"'
      ].join('\n')
    )
    // The real /usr/bin/cc is the shim that can open the install dialog.
    tool(path.join(root, 'bin/cc'), 'echo "cc shim" >> "$SEAL_TEST_LOG"; exit 1')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('builds once with an Xcode whose developer directory holds no usr/bin', () => {
    const developerDir = path.join(root, 'Applications/Xcode.app/Contents/Developer')
    const cc = compiler(path.join(developerDir, 'Toolchains/XcodeDefault.xctoolchain/usr/bin/cc'))

    expect(existsSync(path.join(developerDir, 'usr/bin'))).toBe(false)
    expect(read(developerDir, cc)).toBe('@mactemp\tsmc\tTp0X\t61.2\n')
    expect(read(developerDir, cc)).toBe('@mactemp\tsmc\tTp0X\t61.2\n')
    expect(calls()).toEqual(['xcode-select -p', 'xcrun --find cc', 'xcrun cc -x', 'compile'])
  })

  it('builds with the Command Line Tools', () => {
    const developerDir = path.join(root, 'Library/Developer/CommandLineTools')
    const cc = compiler(path.join(developerDir, 'usr/bin/cc'))

    expect(read(developerDir, cc)).toBe('@mactemp\tsmc\tTp0X\t61.2\n')
  })

  it('never reaches for xcrun or cc on a Mac with no developer directory', () => {
    expect(read('', '')).toBe('')
    expect(read(path.join(root, 'Applications/Gone.app/Contents/Developer'), '')).toBe('')

    expect(calls()).toEqual(['xcode-select -p', 'xcode-select -p'])
    expect(helperFiles()).toEqual([])
  })

  it('waits for a compiler without marking the build as failed', () => {
    const developerDir = path.join(root, 'Library/Developer/CommandLineTools')
    mkdirSync(developerDir, { recursive: true })

    expect(read(developerDir, path.join(developerDir, 'usr/bin/cc'))).toBe('')
    expect(calls()).toEqual(['xcode-select -p', 'xcrun --find cc'])
    expect(helperFiles()).toEqual([])

    const cc = compiler(path.join(developerDir, 'usr/bin/cc'))
    expect(read(developerDir, cc)).toBe('@mactemp\tsmc\tTp0X\t61.2\n')
  })
})
