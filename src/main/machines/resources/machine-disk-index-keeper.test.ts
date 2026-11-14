import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MachineId } from '../../../shared/machines/machine-types'
import type { MachineView } from '../../../shared/machines/machine-view'
import { createLocalMachineConnection } from '../connection/local-machine-connection'
import type { MachineConnection } from '../connection/machine-connection'

const MINUTE_MS = 60_000
const ensured: MachineId[] = []
let dueAfterMs = MINUTE_MS

vi.mock('./machine-disk-index', () => ({
  keepMachineDiskIndex: async (connection: MachineConnection) => {
    ensured.push(connection.machineId)
    return Date.now() + dueAfterMs
  }
}))

function sshMachine(id: MachineId, connected: boolean): MachineConnection {
  return {
    ...createLocalMachineConnection(),
    machineId: id,
    transport: 'ssh',
    isConnected: () => connected
  }
}

function view(id: MachineId): MachineView {
  return { id, recordId: id, name: id, connection: 'ssh', ssh: null, server: null }
}

/** A fresh keeper: it starts once per process. */
async function loadKeeper(): Promise<(skipReason: string | null) => void> {
  vi.resetModules()
  return (await import('./machine-disk-index-keeper')).startMachineDiskIndexKeeper
}

describe('the disk index keeper', () => {
  beforeEach(() => {
    ensured.length = 0
    dueAfterMs = MINUTE_MS
    vi.useFakeTimers()
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("starts this computer's index in an app an agent launched in the background", async () => {
    vi.stubEnv('ORCA_BACKGROUND_LAUNCH', '1')
    const startMachineDiskIndexKeeper = await loadKeeper()

    startMachineDiskIndexKeeper(null)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(ensured).toEqual(['local'])
  })

  it('comes back to this computer and to connected machines, and dials nobody', async () => {
    const startMachineDiskIndexKeeper = await loadKeeper()
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

    startMachineDiskIndexKeeper(null)
    await vi.advanceTimersByTimeAsync(30_000 + MINUTE_MS)

    expect(ensured).toEqual(['local', 'machine:up', 'local', 'machine:up'])
  })

  it('sleeps until a machine is due again', async () => {
    dueAfterMs = 30 * MINUTE_MS
    const startMachineDiskIndexKeeper = await loadKeeper()

    startMachineDiskIndexKeeper(null)
    await vi.advanceTimersByTimeAsync(30_000 + 29 * MINUTE_MS)
    expect(ensured).toEqual(['local'])

    await vi.advanceTimersByTimeAsync(MINUTE_MS)
    expect(ensured).toEqual(['local', 'local'])
  })

  it('leaves the disk alone in a run that says why, and writes the reason down', async () => {
    const startMachineDiskIndexKeeper = await loadKeeper()

    startMachineDiskIndexKeeper('this is an end-to-end test run')
    await vi.advanceTimersByTimeAsync(60 * MINUTE_MS)

    expect(ensured).toEqual([])
    expect(console.info).toHaveBeenCalledWith(
      '[disk-index] local machine local: the disk index is not started here: this is an end-to-end test run'
    )
  })
})
