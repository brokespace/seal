// Starts the real index daemon the way a packaged app does: the program is bundled as the build
// bundles it, read from where a packaged macOS app keeps it, and run through this machine's sh.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { bundleDiskUsageIndexProgram } from '../../../../config/build-plugins/disk-usage-index-bundle'
import { installFakeAppEnvironment } from '../../../../config/scripts/test-runtime/environment/vitest-host-ports-setup'
import type { MachineDiskIndexReply } from '../../../shared/machines/machine-disk-index-types'
import type { MachineId } from '../../../shared/machines/machine-types'
import type { MachineConnection } from '../connection/machine-connection'
import { discoverDiskIndexRoots } from '../disk-index/disk-index-mounts'

// The login shell only supplies the environment; the test's own is the one that names the home.
vi.mock('../../startup/shell-environment/login-shell-environment', () => ({
  resolveLoginShellEnvironment: async () => process.env
}))

// What the desktop's machine list needs from Electron: a profile folder and the open windows.
vi.mock('electron', () => ({
  app: { getPath: () => join(root, 'profile') },
  BrowserWindow: { getAllWindows: () => [] }
}))

type TraceSpan = { name: string; attributes: Record<string, unknown> }

let root = ''
let programCode = ''

function packagedResources(appName: string, code: string): string {
  const resources = join(root, appName, 'Contents', 'Resources')
  const unpacked = join(resources, 'app.asar.unpacked', 'out', 'main')
  mkdirSync(unpacked, { recursive: true })
  writeFileSync(join(unpacked, 'disk-usage-index-entry.js'), code)
  return resources
}

/** A home whose index has nothing to walk, so the test never reads the real disks. */
async function emptyHome(name: string): Promise<string> {
  const home = join(root, name)
  const dataDir = join(home, '.seal', 'disk-index')
  mkdirSync(dataDir, { recursive: true })
  const mounts = (await discoverDiskIndexRoots(true)).map((disk) => disk.mount)
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ exclude: mounts }))
  return home
}

function installedPrograms(home: string): string[] {
  return readdirSync(join(home, '.seal', 'disk-index')).filter((name) =>
    name.startsWith('disk-usage-index-')
  )
}

function daemonPids(home: string): string[] {
  try {
    return execFileSync('pgrep', ['-f', `${home}/.seal/disk-index/disk-usage-index-.*daemon`], {
      encoding: 'utf8'
    })
      .trim()
      .split('\n')
  } catch {
    return []
  }
}

/** Loads the start path as a Seal installed at `resources` would, on this machine as `machineId`. */
async function sealInstalledAt(
  resources: string,
  home: string,
  machineId: MachineId
): Promise<{
  connection: MachineConnection
  query: (
    connection: MachineConnection,
    request: { op: 'status' }
  ) => Promise<MachineDiskIndexReply>
}> {
  vi.resetModules()
  vi.stubEnv('HOME', home)
  installFakeAppEnvironment({
    getAppPath: () => join(resources, 'app.asar'),
    isPackaged: () => true
  })
  const { createLocalMachineConnection } = await import('../connection/local-machine-connection')
  const { queryMachineDiskIndex } = await import('./machine-disk-index')
  return {
    connection: { ...createLocalMachineConnection(), machineId },
    query: queryMachineDiskIndex
  }
}

describe.skipIf(process.platform === 'win32')('starting the disk index from a packaged app', () => {
  beforeAll(async () => {
    // Short, because the daemon's socket path has to fit the system's limit.
    root = mkdtempSync('/tmp/sdi-')
    programCode = (await bundleDiskUsageIndexProgram()).code
  })

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  afterAll(() => {
    try {
      execFileSync('pkill', ['-f', root])
    } catch {
      // No daemon was left running.
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('copies the program out of the app and answers from a running daemon', async () => {
    const resources = packagedResources('Seal.app', programCode)
    const home = await emptyHome('h1')
    const { connection, query } = await sealInstalledAt(resources, home, 'local')

    const reply = await query(connection, { op: 'status' })

    expect(reply).toMatchObject({
      ok: true,
      status: { source: 'index', unavailableReason: null }
    })
    const installed = installedPrograms(home)
    expect(installed).toHaveLength(1)
    expect(readFileSync(join(home, '.seal', 'disk-index', installed[0]), 'utf8')).toBe(programCode)
    expect(daemonPids(home)).toHaveLength(1)
    expect(console.info).toHaveBeenCalledWith(
      '[disk-index] local machine local: the disk index is answering'
    )
  })

  it('lets a second Seal build use the daemon the first one started', async () => {
    const home = await emptyHome('h2')
    const first = await sealInstalledAt(packagedResources('First.app', programCode), home, 'local')
    await first.query(first.connection, { op: 'status' })
    const running = daemonPids(home)

    const otherBuild = `${programCode}\n// another build\n`
    const second = await sealInstalledAt(packagedResources('Second.app', otherBuild), home, 'local')
    const reply = await second.query(second.connection, { op: 'status' })

    expect(reply).toMatchObject({ ok: true, status: { source: 'index' } })
    expect(running).toHaveLength(1)
    expect(daemonPids(home)).toEqual(running)
    expect(installedPrograms(home)).toHaveLength(2)
  })

  it('says that the program could not be copied, and why', async () => {
    const resources = packagedResources('Seal.app', programCode)
    const home = join(root, 'h3')
    mkdirSync(home)
    writeFileSync(join(home, '.seal'), 'not a folder')
    const { connection, query } = await sealInstalledAt(resources, home, 'machine:no-folder')

    const reply = await query(connection, { op: 'status' })

    expect(reply).toMatchObject({
      ok: true,
      status: { source: 'live', unavailableReason: 'install-failed' }
    })
    const detail = 'status' in reply ? reply.status.unavailableDetail : null
    expect(detail).toMatch(/ENOTDIR|EEXIST/)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[disk-index\] local machine machine:no-folder: the disk index is not available \(install-failed\): E/
      )
    )
  })

  it('says what the daemon wrote when it does not come up', async () => {
    const resources = packagedResources('Seal.app', programCode)
    const home = await emptyHome('h4')
    // A folder where the socket belongs: the daemon can neither bind it nor clear it away.
    mkdirSync(join(home, '.seal', 'disk-index', 'daemon.sock', 'in-the-way'), { recursive: true })
    const { connection, query } = await sealInstalledAt(resources, home, 'machine:no-socket')

    const reply = await query(connection, { op: 'status' })

    expect(reply).toMatchObject({
      ok: true,
      status: { source: 'live', unavailableReason: 'daemon-failed' }
    })
    const detail = 'status' in reply ? reply.status.unavailableDetail : null
    expect(detail).toContain('daemon.sock')
    expect(daemonPids(home)).toEqual([])
  })

  it('says so when this copy of Seal has no program to run', async () => {
    const resources = join(root, 'Empty.app', 'Contents', 'Resources')
    const home = await emptyHome('h5')
    const { connection, query } = await sealInstalledAt(resources, home, 'machine:no-program')

    const reply = await query(connection, { op: 'status' })

    expect(reply).toMatchObject({
      ok: true,
      status: { source: 'live', unavailableReason: 'no-program' }
    })
    expect(installedPrograms(home)).toEqual([])
  })

  it('is started by the keeper as the desktop starts, before any timer fires or window exists', async () => {
    const home = await emptyHome('h6')
    await sealInstalledAt(packagedResources('Seal.app', programCode), home, 'local')
    const { setActiveSink } = await import('../../observability/tracer')
    const { setMachineAccess } = await import('../machine-services')
    const { desktopMachineAccess } = await import('../registry/machine-registry-service')
    const { startMachineDiskIndexKeeper } = await import('./machine-disk-index-keeper')
    const spans: TraceSpan[] = []
    let passEnded = (): void => {}
    setActiveSink({
      push: (record) => {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the tracer hands its sink the span records it built, which have this shape.
        const span = record as TraceSpan
        spans.push(span)
        if (span.attributes.event === 'pass') {
          passEnded()
        }
      },
      flush: () => {},
      close: () => {}
    })
    const firstPassEnded = new Promise<void>((resolve) => {
      passEnded = resolve
    })
    // No timer runs until the test says so; the daemon is started and asked in real time.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    startMachineDiskIndexKeeper({ orcadSidecar: false })
    await firstPassEnded

    expect(daemonPids(home)).toHaveLength(1)
    expect(spans.map((span) => ({ span: span.name, ...span.attributes }))).toEqual([
      { span: 'machines.disk-index.keeper', event: 'started', pid: process.pid },
      {
        span: 'machines.disk-index.keeper',
        event: 'pass-due',
        pass: 1,
        by: 'start',
        lateBySeconds: 0
      },
      {
        span: 'machines.disk-index.keeper',
        event: 'pass-began',
        pass: 1,
        machines: 'local',
        otherMachinesConnected: 0,
        otherMachinesNotConnected: 0
      },
      {
        span: 'machines.disk-index',
        machineId: 'local',
        transport: 'local',
        outcome: 'answering',
        reason: null,
        detail: null
      },
      {
        span: 'machines.disk-index.keeper',
        event: 'pass',
        pass: 1,
        machines: 'local answering',
        otherMachinesNotConnected: 0,
        errors: null,
        nextPassInSeconds: 1800
      }
    ])

    // Attaching the window hands the keeper the desktop's own machine list for later passes.
    setMachineAccess(desktopMachineAccess())
    await vi.advanceTimersByTimeAsync(30 * 60_000)

    expect(spans.slice(5).map((span) => span.attributes)).toEqual([
      { event: 'pass-due', pass: 2, by: 'timer', lateBySeconds: 0 },
      {
        event: 'pass-began',
        pass: 2,
        machines: 'local',
        otherMachinesConnected: 0,
        otherMachinesNotConnected: 0
      },
      {
        event: 'pass',
        pass: 2,
        machines: 'local answering (not due)',
        otherMachinesNotConnected: 0,
        errors: null,
        nextPassInSeconds: 1800
      }
    ])
  })

  it('gives up on a machine that never answers, and writes that down', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const { createLocalMachineConnection } = await import('../connection/local-machine-connection')
    const { keepMachineDiskIndex } = await import('./machine-disk-index')
    const silent: MachineConnection = {
      ...createLocalMachineConnection(),
      machineId: 'machine:silent',
      dialect: () => new Promise<never>(() => {})
    }

    const keeping = keepMachineDiskIndex(silent)
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    await expect(keeping).resolves.toMatchObject({ state: 'not-available', asked: true })
    expect(console.warn).toHaveBeenCalledWith(
      '[disk-index] local machine machine:silent: the disk index is not available (command-failed): The machine did not answer within 5 minutes of being asked; it was asking which shell the machine has.'
    )
  })
})
