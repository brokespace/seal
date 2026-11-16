import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MachineId } from '../../../shared/machines/machine-types'
import type { MachineView } from '../../../shared/machines/machine-view'
import { createLocalMachineConnection } from '../connection/local-machine-connection'
import type { MachineConnection, MachineTransport } from '../connection/machine-connection'

const MINUTE_MS = 60_000
const ensured: MachineId[] = []
const ensuredOver: MachineTransport[] = []
const silent = new Set<MachineId>()
let dueAfterMs = MINUTE_MS

vi.mock('./machine-disk-index', () => ({
  keepMachineDiskIndex: (connection: MachineConnection) => {
    ensured.push(connection.machineId)
    ensuredOver.push(connection.transport)
    return silent.has(connection.machineId)
      ? new Promise(() => {})
      : Promise.resolve({ dueAt: Date.now() + dueAfterMs, state: 'answering', asked: true })
  },
  diskIndexStartStep: (machineId: MachineId) =>
    silent.has(machineId) ? 'running the start script' : null
}))

type TraceSpan = { name: string; attributes: Record<string, unknown> }

function sshMachine(id: MachineId, connected: boolean): MachineConnection {
  return {
    ...createLocalMachineConnection(),
    machineId: id,
    transport: 'ssh',
    isConnected: () => connected
  }
}

function view(id: MachineId): MachineView {
  return {
    id,
    recordId: id,
    name: id,
    connection: 'ssh',
    ssh: null,
    server: null,
    serverInstall: null,
    serverInstallAction: 'none'
  }
}

/** A fresh keeper: it starts once per process. `passes` reads what it wrote to the trace file. */
async function loadKeeper(): Promise<{
  startMachineDiskIndexKeeper: (launch: { orcadSidecar: boolean }) => void
  passes: () => Record<string, unknown>[]
}> {
  vi.resetModules()
  const spans: TraceSpan[] = []
  const { setActiveSink } = await import('../../observability/tracer')
  setActiveSink({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the tracer hands its sink the span records it built, which have this shape.
    push: (record) => spans.push(record as TraceSpan),
    flush: () => {},
    close: () => {}
  })
  const { startMachineDiskIndexKeeper } = await import('./machine-disk-index-keeper')
  return {
    startMachineDiskIndexKeeper,
    passes: () =>
      spans
        .filter((span) => span.name === 'machines.disk-index.keeper')
        .map((span) => span.attributes)
        .filter((attributes) => attributes.event !== 'started')
  }
}

describe('the disk index keeper', () => {
  beforeEach(() => {
    ensured.length = 0
    ensuredOver.length = 0
    silent.clear()
    dueAfterMs = MINUTE_MS
    vi.useFakeTimers()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('begins the first pass when it starts, without waiting for any timer to fire', async () => {
    const { startMachineDiskIndexKeeper, passes } = await loadKeeper()

    startMachineDiskIndexKeeper({ orcadSidecar: false })

    expect(ensured).toEqual(['local'])
    expect(passes()).toEqual([
      { event: 'pass-due', pass: 1, by: 'start', lateBySeconds: 0 },
      {
        event: 'pass-began',
        pass: 1,
        machines: 'local',
        otherMachinesConnected: 0,
        otherMachinesNotConnected: 0
      }
    ])
  })

  it("starts this computer's index in an app an agent launched in the background", async () => {
    vi.stubEnv('ORCA_BACKGROUND_LAUNCH', '1')
    const { startMachineDiskIndexKeeper } = await loadKeeper()

    startMachineDiskIndexKeeper({ orcadSidecar: false })

    expect(ensured).toEqual(['local'])
  })

  it('comes back to this computer and to connected machines, and dials nobody', async () => {
    const { startMachineDiskIndexKeeper, passes } = await loadKeeper()
    const { setMachineAccess } = await import('../machine-services')
    const machines = new Map<MachineId, MachineConnection>([
      ['local', createLocalMachineConnection()],
      ['machine:up', sshMachine('machine:up', true)],
      ['machine:down', sshMachine('machine:down', false)]
    ])
    setMachineAccess({
      views: () => [view('machine:up'), view('machine:down')],
      connection: (machineId) => machines.get(machineId) ?? sshMachine(machineId, false),
      liveSessionSources: () => []
    })

    startMachineDiskIndexKeeper({ orcadSidecar: false })
    await vi.advanceTimersByTimeAsync(0)

    expect(passes()).toEqual([
      { event: 'pass-due', pass: 1, by: 'start', lateBySeconds: 0 },
      {
        event: 'pass-began',
        pass: 1,
        machines: 'local, machine:up',
        otherMachinesConnected: 1,
        otherMachinesNotConnected: 1
      },
      {
        event: 'pass',
        pass: 1,
        machines: 'local answering, machine:up answering',
        otherMachinesNotConnected: 1,
        errors: null,
        nextPassInSeconds: 60
      }
    ])

    await vi.advanceTimersByTimeAsync(MINUTE_MS)

    expect(ensured).toEqual(['local', 'machine:up', 'local', 'machine:up'])
  })

  it('keeps this computer, and writes down why, when the machine list cannot be read', async () => {
    const { startMachineDiskIndexKeeper, passes } = await loadKeeper()
    const { setMachineAccess } = await import('../machine-services')
    const broken = (): never => {
      throw new Error('the registry is broken')
    }
    setMachineAccess({ views: broken, connection: broken, liveSessionSources: () => [] })

    startMachineDiskIndexKeeper({ orcadSidecar: false })
    await vi.advanceTimersByTimeAsync(0)

    expect(ensured).toEqual(['local'])
    expect(ensuredOver).toEqual(['local'])
    expect(passes().at(-1)).toMatchObject({
      event: 'pass',
      pass: 1,
      machines: 'local answering',
      errors:
        'the machine list did not hand out this computer: the registry is broken | ' +
        'the other machines could not be listed: the registry is broken'
    })
  })

  it('keeps this computer whether or not its connection says it is connected', async () => {
    const { startMachineDiskIndexKeeper } = await loadKeeper()
    const { setMachineAccess } = await import('../machine-services')
    setMachineAccess({
      views: () => [],
      connection: () => ({ ...createLocalMachineConnection(), isConnected: () => false }),
      liveSessionSources: () => []
    })

    startMachineDiskIndexKeeper({ orcadSidecar: false })

    expect(ensured).toEqual(['local'])
  })

  it('sleeps until a machine is due again', async () => {
    dueAfterMs = 30 * MINUTE_MS
    const { startMachineDiskIndexKeeper } = await loadKeeper()

    startMachineDiskIndexKeeper({ orcadSidecar: false })
    await vi.advanceTimersByTimeAsync(29 * MINUTE_MS)
    expect(ensured).toEqual(['local'])

    await vi.advanceTimersByTimeAsync(MINUTE_MS)
    expect(ensured).toEqual(['local', 'local'])
  })

  it('writes down how late a pass began when its timer was held back', async () => {
    dueAfterMs = 30 * MINUTE_MS
    const { startMachineDiskIndexKeeper, passes } = await loadKeeper()
    startMachineDiskIndexKeeper({ orcadSidecar: false })
    await vi.advanceTimersByTimeAsync(0)

    // The clock moves on while no timer runs, as when the process is not being run.
    vi.setSystemTime(Date.now() + 10 * MINUTE_MS)
    await vi.advanceTimersByTimeAsync(30 * MINUTE_MS)

    expect(passes()).toContainEqual({ event: 'pass-due', pass: 2, by: 'timer', lateBySeconds: 600 })
  })

  it('begins a pass from the watchdog when the timer for it never fires', async () => {
    const { startMachineDiskIndexKeeper, passes } = await loadKeeper()
    const schedule = globalThis.setTimeout
    const lost = vi.spyOn(globalThis, 'setTimeout')
    startMachineDiskIndexKeeper({ orcadSidecar: false })
    // The next timer set is the one for pass 2; the watchdog is set after it.
    lost.mockImplementationOnce(() => schedule(() => {}, 0))
    await vi.advanceTimersByTimeAsync(2 * MINUTE_MS)

    expect(passes()).toContainEqual({
      event: 'pass-due',
      pass: 2,
      by: 'watchdog',
      lateBySeconds: 60
    })
    expect(ensured).toEqual(['local', 'local'])
  })

  it('writes down which machine a pass is still waiting for after a minute', async () => {
    const { startMachineDiskIndexKeeper, passes } = await loadKeeper()
    const { setMachineAccess } = await import('../machine-services')
    const machines = new Map<MachineId, MachineConnection>([
      ['local', createLocalMachineConnection()],
      ['machine:quiet', sshMachine('machine:quiet', true)]
    ])
    setMachineAccess({
      views: () => [view('machine:quiet')],
      connection: (machineId) => machines.get(machineId) ?? sshMachine(machineId, false),
      liveSessionSources: () => []
    })
    silent.add('machine:quiet')

    startMachineDiskIndexKeeper({ orcadSidecar: false })
    await vi.advanceTimersByTimeAsync(MINUTE_MS)

    expect(passes().at(-1)).toEqual({
      event: 'pass-slow',
      pass: 1,
      runningForSeconds: 60,
      waitingOn: 'machine:quiet (running the start script)'
    })
  })

  it('leaves the disk alone in an end-to-end test run, and writes that down', async () => {
    vi.stubEnv('ORCA_E2E_USER_DATA_DIR', '/tmp/e2e-profile')
    const { startMachineDiskIndexKeeper } = await loadKeeper()

    startMachineDiskIndexKeeper({ orcadSidecar: false })
    await vi.advanceTimersByTimeAsync(60 * MINUTE_MS)

    expect(ensured).toEqual([])
    expect(console.info).toHaveBeenCalledWith(
      '[disk-index] local machine local: the disk index is not started here: this is an end-to-end test run'
    )
  })

  it('leaves the disk alone in the browser sidecar a server starts', async () => {
    const { startMachineDiskIndexKeeper } = await loadKeeper()

    startMachineDiskIndexKeeper({ orcadSidecar: true })
    await vi.advanceTimersByTimeAsync(60 * MINUTE_MS)

    expect(ensured).toEqual([])
  })
})
