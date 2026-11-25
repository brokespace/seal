import { describe, expect, it } from 'vitest'
import type { MachineExecResult } from '../../../shared/machines/machine-host-wire'
import { toMachineId } from '../../../shared/machines/machine-types'
import { createLocalMachineConnection } from '../connection/local-machine-connection'
import type { MachineConnection, MachineExecOptions } from '../connection/machine-connection'
import {
  parseWindowsCpuTemperatureSetup,
  runWindowsCpuTemperatureSetup
} from './machine-cpu-temperature-windows-setup'

type Probe = Record<string, unknown>

/** What the status script prints for a PC where nothing is set up, seen by an administrator at its desktop. */
const FRESH: Probe = {
  installed: false,
  task: false,
  process: false,
  answering: false,
  ok: null,
  message: '',
  admin: true,
  elevated: false,
  session: 1,
  account: 'kessel-pc\\brian'
}
const INSTALLED: Probe = { ...FRESH, installed: true, task: true, ok: true }

const status = (probe: Probe): string => `SEAL_CPU_TEMP_SETUP ${JSON.stringify(probe)}\r\n`

type Exec = { script: string; stdin: MachineExecOptions['stdin'] }

/** A Windows machine that answers each script with the next of `answers`, and remembers what it was sent. */
function windowsMachine(answers: string[]): { connection: MachineConnection; sent: Exec[] } {
  const sent: Exec[] = []
  const connection: MachineConnection = {
    ...createLocalMachineConnection(),
    machineId: toMachineId('kessel-pc'),
    dialect: async () => 'powershell',
    exec: async (script, options): Promise<MachineExecResult> => {
      sent.push({ script, stdin: options.stdin })
      return { stdout: answers.shift() ?? '', stderr: '', exitCode: 0, timedOut: false }
    }
  }
  return { connection, sent }
}

describe('Windows CPU temperature setup status', () => {
  it('tells the states of the monitor apart', () => {
    const state = (probe: Probe) => {
      const { state, message } = parseWindowsCpuTemperatureSetup(status(probe))
      return { state, message }
    }

    expect(state(FRESH)).toEqual({ state: 'not-set-up', message: null })
    expect(state({ ...INSTALLED, process: true, answering: true })).toEqual({
      state: 'running',
      message: null
    })
    expect(state(INSTALLED)).toEqual({ state: 'stopped', message: null })
    expect(
      state({ ...FRESH, ok: false, message: 'Setup stopped while preparing: Access is denied.' })
    ).toEqual({ state: 'failed', message: 'Setup stopped while preparing: Access is denied.' })
    expect(state({ ...INSTALLED, task: false })).toEqual({
      state: 'failed',
      message: 'The scheduled task that starts the monitor is missing.'
    })
    expect(state({ ...INSTALLED, process: true })).toEqual({
      state: 'failed',
      message: 'LibreHardwareMonitor is running, but its web server does not answer on port 18085.'
    })
  })

  it('says how each connection would get administrator rights', () => {
    const elevation = (probe: Probe) =>
      parseWindowsCpuTemperatureSetup(`Windows PowerShell\r\n${status(probe)}`).elevation

    expect(elevation(FRESH)).toBe('prompt')
    expect(elevation({ ...FRESH, admin: false })).toBe('needs-admin')
    expect(elevation({ ...FRESH, session: 0 })).toBe('no-desktop')
    expect(elevation({ ...FRESH, session: 0, elevated: true })).toBe('elevated')
  })

  it('refuses output that carries no status', () => {
    expect(() => parseWindowsCpuTemperatureSetup('Access is denied.')).toThrow(
      'The machine did not report on its CPU temperature setup.'
    )
  })
})

describe('Windows CPU temperature setup actions', () => {
  it.each([
    ['an account that is not an administrator', { ...FRESH, admin: false }],
    ['a connection with no desktop for the prompt', { ...FRESH, session: 0 }]
  ])('never asks Windows for administrator rights from %s', async (_name, probe) => {
    const { connection, sent } = windowsMachine([status(probe)])

    const result = await runWindowsCpuTemperatureSetup(connection, 'install')

    expect(result.outcome).toBe('blocked')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.script).not.toContain('Start-Process')
  })

  it('starts a stopped monitor through its task, without elevating', async () => {
    const { connection, sent } = windowsMachine([
      // Even an account that could not install it may start what is installed.
      status({ ...INSTALLED, admin: false }),
      'SEAL_CPU_TEMP_RUN {"outcome":"done","detail":"","exit":0}',
      status({ ...INSTALLED, admin: false, process: true, answering: true })
    ])

    const result = await runWindowsCpuTemperatureSetup(connection, 'install')

    expect(result).toMatchObject({ outcome: 'done', setup: { state: 'running' } })
    expect(sent[1]?.script).toContain("schtasks.exe /run /tn 'Seal CPU temperature'")
    expect(sent[1]?.script).not.toContain('RunAs')
    expect(sent[1]?.stdin).toBeUndefined()
  })

  it('reports a declined Windows prompt and leaves the machine as it was', async () => {
    const { connection, sent } = windowsMachine([
      status(FRESH),
      'SEAL_CPU_TEMP_RUN {"outcome":"declined","detail":"","exit":null}',
      status(FRESH)
    ])

    const result = await runWindowsCpuTemperatureSetup(connection, 'install')

    expect(result).toMatchObject({ outcome: 'declined', setup: { state: 'not-set-up' } })
    expect(sent[1]?.script).toContain("$start.Verb = 'RunAs'")
    expect(String(sent[1]?.stdin)).toContain('Register-ScheduledTask')
  })

  it('counts an elevated script that died without a word as a failure', async () => {
    const { connection } = windowsMachine([
      status(FRESH),
      'SEAL_CPU_TEMP_RUN {"outcome":"done","detail":"","exit":1}',
      status(FRESH)
    ])

    expect(await runWindowsCpuTemperatureSetup(connection, 'install')).toMatchObject({
      outcome: 'failed',
      detail: 'The elevated setup ended with code 1 without saying why.'
    })
  })

  it('is refused for a machine that is not Windows', async () => {
    const connection: MachineConnection = {
      ...createLocalMachineConnection(),
      dialect: async () => 'posix'
    }

    await expect(runWindowsCpuTemperatureSetup(connection, 'install')).rejects.toThrow(
      'CPU temperature setup is only for Windows machines.'
    )
  })
})
