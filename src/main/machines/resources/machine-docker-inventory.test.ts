import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MachineConnection } from '../connection/machine-connection'
import { forgetDockerInventory, readMachineDockerStorage } from './machine-docker-inventory'
import { runMachineHostScript } from './machine-host-script'

vi.mock('./machine-host-script', () => ({ runMachineHostScript: vi.fn() }))

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the script runner is mocked, so only machineId is read.
const connection = { machineId: 'df-box' } as unknown as MachineConnection
const run = vi.mocked(runMachineHostScript)
const MINUTE = 60_000

type ScriptResult = Awaited<ReturnType<typeof runMachineHostScript>>

function answer(stdout: string): ScriptResult {
  return { stdout, stderr: '', exitCode: 0, timedOut: false }
}

function collectedAt(storage: Awaited<ReturnType<typeof readMachineDockerStorage>>): number {
  if (storage.state !== 'ready') {
    throw new Error('Docker did not answer')
  }
  return storage.collectedAt
}

describe('readMachineDockerStorage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    run.mockReset()
    forgetDockerInventory(connection)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('serves a stale answer at once while one background read renews it', async () => {
    run.mockResolvedValueOnce(answer('@ready\n'))
    expect(collectedAt(await readMachineDockerStorage(connection))).toBe(1_000_000)

    vi.setSystemTime(1_000_000 + 2 * MINUTE)
    await readMachineDockerStorage(connection)
    expect(run).toHaveBeenCalledTimes(1)

    let finish: (result: ScriptResult) => void = () => {}
    run.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    vi.setSystemTime(1_000_000 + 4 * MINUTE)
    const first = await readMachineDockerStorage(connection)
    const second = await readMachineDockerStorage(connection)
    expect(collectedAt(first)).toBe(1_000_000)
    expect(collectedAt(second)).toBe(1_000_000)
    expect(run).toHaveBeenCalledTimes(2)

    finish(answer('@ready\n'))
    await vi.advanceTimersByTimeAsync(0)
    expect(collectedAt(await readMachineDockerStorage(connection))).toBe(1_000_000 + 4 * MINUTE)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('keeps the last good answer when the background read fails', async () => {
    run.mockResolvedValueOnce(answer('@ready\n'))
    await readMachineDockerStorage(connection)

    vi.setSystemTime(1_000_000 + 4 * MINUTE)
    run.mockRejectedValue(new Error('timed out'))
    expect(collectedAt(await readMachineDockerStorage(connection))).toBe(1_000_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(collectedAt(await readMachineDockerStorage(connection))).toBe(1_000_000)
  })

  it('reads fresh after an invalidating change', async () => {
    run.mockResolvedValueOnce(answer('@ready\n'))
    await readMachineDockerStorage(connection)

    forgetDockerInventory(connection)
    vi.setSystemTime(1_000_000 + MINUTE)
    run.mockResolvedValueOnce(answer('@ready\n'))
    expect(collectedAt(await readMachineDockerStorage(connection))).toBe(1_000_000 + MINUTE)
  })
})
