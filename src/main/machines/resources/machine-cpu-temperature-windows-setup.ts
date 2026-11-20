import type {
  MachineCpuTemperatureSetup,
  MachineCpuTemperatureSetupAction,
  MachineCpuTemperatureSetupResult
} from '../../../shared/machines/machine-cpu-temperature-types'
import type { MachineConnection } from '../connection/machine-connection'
import { SEAL_LIBRE_HARDWARE_MONITOR_PORT } from './machine-cpu-temperature-windows'
import {
  INSTALL_LAUNCH_SCRIPT,
  INSTALL_SCRIPT,
  OUTCOME_MARKER,
  REMOVE_LAUNCH_SCRIPT,
  REMOVE_SCRIPT,
  SETTLED_STATUS_SCRIPT,
  SETUP_MARKER,
  START_SCRIPT,
  STATUS_SCRIPT
} from './machine-cpu-temperature-windows-setup-scripts'

const STATUS_TIMEOUT_MS = 30_000
// Covers the wait for the Windows prompt, two downloads and the driver's installer.
const ACTION_TIMEOUT_MS = 15 * 60_000
function isFields(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function markedFields(output: string, marker: string): Record<string, unknown> {
  const line = output.split(/\r?\n/).find((candidate) => candidate.includes(marker))
  let fields: unknown
  try {
    fields = JSON.parse(line?.slice(line.indexOf(marker) + marker.length) ?? '')
  } catch {
    fields = null
  }
  if (!isFields(fields)) {
    throw new Error('The machine did not report on its CPU temperature setup.')
  }
  return fields
}

/** Reads the marked JSON line the status script ends with; throws when the machine printed none. */
export function parseWindowsCpuTemperatureSetup(output: string): MachineCpuTemperatureSetup {
  const probe = markedFields(output, SETUP_MARKER)
  const installed = probe.installed === true
  const message = typeof probe.message === 'string' && probe.message !== '' ? probe.message : null
  let setup: Pick<MachineCpuTemperatureSetup, 'state' | 'message'>
  if (installed && probe.answering === true) {
    setup = { state: 'running', message }
  } else if (probe.ok === false) {
    setup = { state: 'failed', message }
  } else if (!installed) {
    setup = { state: 'not-set-up', message: null }
  } else if (probe.task !== true) {
    setup = { state: 'failed', message: 'The scheduled task that starts the monitor is missing.' }
  } else if (probe.process === true) {
    setup = {
      state: 'failed',
      message: `LibreHardwareMonitor is running, but its web server does not answer on port ${SEAL_LIBRE_HARDWARE_MONITOR_PORT}.`
    }
  } else {
    setup = { state: 'stopped', message }
  }
  return {
    ...setup,
    elevation:
      probe.elevated === true
        ? 'elevated'
        : probe.admin !== true
          ? 'needs-admin'
          : // Session 0 holds services and SSH logins: it has no desktop for the prompt.
            probe.session === 0
            ? 'no-desktop'
            : 'prompt',
    account: typeof probe.account === 'string' ? probe.account.trim() : ''
  }
}

async function runSetupScript(
  connection: MachineConnection,
  script: string,
  options: { timeoutMs: number; stdin?: string }
): Promise<string> {
  if ((await connection.dialect()) !== 'powershell') {
    throw new Error('CPU temperature setup is only for Windows machines.')
  }
  const result = await connection.exec(script, options)
  if (result.timedOut) {
    throw new Error('The machine took too long to answer.')
  }
  return result.stdout
}

export async function readWindowsCpuTemperatureSetup(
  connection: MachineConnection,
  script = STATUS_SCRIPT
): Promise<MachineCpuTemperatureSetup> {
  return parseWindowsCpuTemperatureSetup(
    await runSetupScript(connection, script, { timeoutMs: STATUS_TIMEOUT_MS })
  )
}

/**
 * Installs, starts or removes the monitor. Only installing and removing need administrator rights,
 * and nothing here asks for them unless the user chose this action.
 */
export async function runWindowsCpuTemperatureSetup(
  connection: MachineConnection,
  action: MachineCpuTemperatureSetupAction
): Promise<MachineCpuTemperatureSetupResult> {
  const setup = await readWindowsCpuTemperatureSetup(connection)
  const start = action === 'install' && setup.state === 'stopped'
  if (setup.state === (action === 'install' ? 'running' : 'not-set-up')) {
    return { outcome: 'done', detail: null, setup }
  }
  if (!start && (setup.elevation === 'needs-admin' || setup.elevation === 'no-desktop')) {
    return { outcome: 'blocked', detail: null, setup }
  }
  const launch = start
    ? { script: START_SCRIPT }
    : action === 'install'
      ? { script: INSTALL_LAUNCH_SCRIPT, stdin: INSTALL_SCRIPT }
      : { script: REMOVE_LAUNCH_SCRIPT, stdin: REMOVE_SCRIPT }
  const run = markedFields(
    await runSetupScript(connection, launch.script, {
      timeoutMs: ACTION_TIMEOUT_MS,
      ...(launch.stdin ? { stdin: launch.stdin } : {})
    }),
    OUTCOME_MARKER
  )
  const outcome = run.outcome === 'declined' || run.outcome === 'failed' ? run.outcome : 'done'
  const after = await readWindowsCpuTemperatureSetup(
    connection,
    outcome === 'done' && action === 'install' ? SETTLED_STATUS_SCRIPT : STATUS_SCRIPT
  )
  // An elevated script that died before it could record why still has to count as a failure.
  if (outcome === 'done' && after.state !== 'failed' && typeof run.exit === 'number' && run.exit) {
    return {
      outcome: 'failed',
      detail: `The elevated setup ended with code ${run.exit} without saying why.`,
      setup: after
    }
  }
  return {
    outcome,
    detail: typeof run.detail === 'string' && run.detail !== '' ? run.detail : null,
    setup: after
  }
}
