// On a machine whose user already runs `seal serve` as a service, an install Seal is asked for writes nothing,
// leaves that server running untouched, and offers to connect through it instead. Needs Docker with cgroup v2
// and ORCA_E2E_ORCAD_CONVERT_TEMPLATE built for linux-x64-glibc.
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import { installOwnSealServe } from './helpers/docker-ssh-host-own-seal-serve'
import {
  dockerSystemdSshHostUnavailableReason,
  startDockerSystemdSshHost,
  type DockerSystemdSshHost
} from './helpers/docker-ssh-host-systemd-target'
import {
  addSshMachine,
  openMachinesPage,
  readMachine,
  sealServerFilesOnHost,
  showMachine
} from './helpers/seal-server-install-machine'

const TEMPLATE = process.env.ORCA_E2E_ORCAD_CONVERT_TEMPLATE
const UNAVAILABLE = dockerSystemdSshHostUnavailableReason()
const MACHINE = 'seal-e2e-own-serve-box'
const OWN_SERVE_PORT = 6768
// Where a server Seal installs as a service listens.
const SEAL_SERVICE_PORT = 16768
const HOST_ANSWER_TIMEOUT_MS = 60_000

test.skip(UNAVAILABLE !== null || !TEMPLATE, UNAVAILABLE ?? 'Set ORCA_E2E_ORCAD_CONVERT_TEMPLATE')

/** Everything an install or a restart of the user's server would change on the host. */
function hostServers(host: DockerSystemdSshHost): Record<string, unknown> {
  return {
    installRoot: host.exec('test -e /home/seal/.orca-remote && echo yes || echo no'),
    sealServerFiles: sealServerFilesOnHost(host),
    sealServer: host.sealServerState(),
    sealServicePortListens: host
      .listeningSockets()
      .some((socket) => socket.port === SEAL_SERVICE_PORT),
    ownServePid: host.loopbackListenerPid(OWN_SERVE_PORT),
    ownServeActive: host.userSystemctl(['is-active', 'seal-serve']).stdout,
    ownServeRestarts: host.userSystemctl(['show', 'seal-serve', '-p', 'NRestarts', '--value'])
      .stdout
  }
}

function untouched(ownServePid: number): Record<string, unknown> {
  return {
    installRoot: 'no',
    sealServerFiles: [],
    sealServer: { serviceActive: false, processIds: [] },
    sealServicePortListens: false,
    ownServePid,
    ownServeActive: 'active',
    ownServeRestarts: '0'
  }
}

async function ownServePid(host: DockerSystemdSshHost): Promise<number> {
  await expect
    .poll(() => host.loopbackListenerPid(OWN_SERVE_PORT), { timeout: HOST_ANSWER_TIMEOUT_MS })
    .not.toBeNull()
  return host.loopbackListenerPid(OWN_SERVE_PORT)!
}

/** The id the running `seal serve` gave itself; a server started again has another. */
function ownServeRuntimeId(host: DockerSystemdSshHost): string {
  const metadata: { runtimeId: string } = JSON.parse(
    host.exec('cat /home/seal/.config/Seal/orca-runtime.json')
  )
  return metadata.runtimeId
}

/** The runtime that answers the desktop through the machine's server, or null when none does. */
function answeringRuntime(page: Page, environmentId: string): Promise<string | null> {
  return page.evaluate(async (selector) => {
    const response = await window.api.runtimeEnvironments.call({
      selector,
      method: 'terminal.list',
      params: {}
    })
    return response.ok ? response._meta.runtimeId : null
  }, environmentId)
}

async function readReuseOffer(page: Page): Promise<Record<string, unknown> | null> {
  const machine = await readMachine(page, MACHINE)
  return machine
    ? {
        connection: machine.connection,
        serverInstallAction: machine.serverInstallAction,
        serverOwnServe: machine.serverOwnServe ?? null
      }
    : null
}

const REUSE_OFFER = {
  connection: 'ssh',
  serverInstallAction: 'reuse',
  serverOwnServe: { manager: 'systemd-user', name: 'seal-serve.service' }
}

async function confirmReuse(page: Page, screenshotPath?: string): Promise<void> {
  await page.locator('[data-machine-server="reuse"] [data-machine-server-action="reuse"]').click()
  const confirmation = page.getByRole('dialog').filter({ hasText: MACHINE })
  await expect(confirmation).toBeVisible()
  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath, animations: 'disabled' })
  }
  await confirmation.getByRole('button', { name: 'Use this server', exact: true }).click()
  await expect(confirmation).toBeHidden()
}

test('an install asked for on a machine that runs its own seal serve installs nothing and offers that server', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its app launch and its host.
{}, testInfo) => {
  // Boots a systemd host and launches the app; the host's answer arrives over a fresh SSH login.
  test.setTimeout(8 * 60_000)
  const host = await startDockerSystemdSshHost(testInfo, { linger: true })
  const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: TEMPLATE! })
  let app: ElectronApplication | null = null
  try {
    host.installOwnServeService()
    const pid = await ownServePid(host)
    const launched = await session.launch()
    app = launched.app
    const { page } = launched
    await waitForSessionReady(page)
    await openMachinesPage(page)

    await test.step('a confirmed install writes nothing and leaves the running server alone', async () => {
      await addSshMachine(page, host.ssh, MACHINE, { installServer: true })
      await expect
        .poll(() => readReuseOffer(page), { timeout: HOST_ANSWER_TIMEOUT_MS })
        .toEqual(REUSE_OFFER)
      expect(hostServers(host)).toEqual(untouched(pid))
    })

    await test.step('the machine page offers the running server', async () => {
      await showMachine(page, MACHINE)
      const band = page.getByRole('region', { name: 'Seal server' })
      await expect(band).toHaveAttribute('data-machine-server', 'reuse')
      await expect(band).toContainText('seal-serve.service')
      await expect(band.locator('[data-machine-server-action="install"]')).toHaveCount(0)
      await page.screenshot({
        path: testInfo.outputPath('reuse-offer.png'),
        animations: 'disabled'
      })
    })

    await test.step('a server that gives no pairing link stays untouched and the user is told to pair by hand', async () => {
      await confirmReuse(page)
      await expect(
        page.locator('[data-sonner-toast]').filter({ hasText: 'seal pair' })
      ).toBeVisible({ timeout: HOST_ANSWER_TIMEOUT_MS })
      expect(await readReuseOffer(page)).toEqual(REUSE_OFFER)
      expect(hostServers(host)).toEqual(untouched(pid))
      await expect(page.getByRole('region', { name: 'Seal server' })).toHaveAttribute(
        'data-machine-server',
        'reuse'
      )
      await page.screenshot({
        path: testInfo.outputPath('reuse-pair-by-hand.png'),
        animations: 'disabled'
      })
    })
  } finally {
    try {
      await session.dispose(app ?? undefined)
    } finally {
      host.dispose()
    }
  }
})

test('a machine added without the install turns to the reuse offer once its SSH session is asked', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its app launch and its host.
{}, testInfo) => {
  // Boots a systemd host and launches the app; the host's answer arrives over a fresh SSH login.
  test.setTimeout(8 * 60_000)
  const host = await startDockerSystemdSshHost(testInfo, { linger: true })
  const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: TEMPLATE! })
  let app: ElectronApplication | null = null
  try {
    host.installOwnServeService()
    const pid = await ownServePid(host)
    const launched = await session.launch()
    app = launched.app
    const { page } = launched
    await waitForSessionReady(page)
    await openMachinesPage(page)
    await addSshMachine(page, host.ssh, MACHINE)
    const added = (await readMachine(page, MACHINE))!
    expect(added).toMatchObject({ connection: 'ssh', serverInstallAction: 'install' })

    await test.step('the open SSH session answers that the machine runs its own server', async () => {
      await page.evaluate((machineId) => window.api.machines!.connect({ machineId }), added.id)
      await expect
        .poll(() => readReuseOffer(page), { timeout: HOST_ANSWER_TIMEOUT_MS })
        .toEqual(REUSE_OFFER)
      await showMachine(page, MACHINE)
      await expect(page.getByRole('region', { name: 'Seal server' })).toHaveAttribute(
        'data-machine-server',
        'reuse'
      )
    })

    await test.step('an install requested without the dialog installs nothing either', async () => {
      const answered = await page.evaluate(
        (machineId) => window.api.machines!.installServer({ machineId }),
        added.id
      )
      expect(answered).toMatchObject(REUSE_OFFER)
      expect(hostServers(host)).toEqual(untouched(pid))
    })
  } finally {
    try {
      await session.dispose(app ?? undefined)
    } finally {
      host.dispose()
    }
  }
})

test('Use this server connects the machine through the seal serve its user runs', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its app launch and its host.
{}, testInfo) => {
  // Boots a systemd host, unpacks and starts a real server on it, and launches the app twice.
  test.setTimeout(8 * 60_000)
  const host = await startDockerSystemdSshHost(testInfo, { linger: true })
  const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: TEMPLATE! })
  let app: ElectronApplication | null = null
  try {
    installOwnSealServe(host, TEMPLATE!)
    const pid = await ownServePid(host)
    const runtimeId = ownServeRuntimeId(host)
    const launched = await session.launch()
    app = launched.app
    const { page } = launched
    await waitForSessionReady(page)
    await openMachinesPage(page)

    await test.step('a confirmed install writes nothing and offers the running server', async () => {
      await addSshMachine(page, host.ssh, MACHINE, { installServer: true })
      await expect
        .poll(() => readReuseOffer(page), { timeout: HOST_ANSWER_TIMEOUT_MS })
        .toEqual(REUSE_OFFER)
      expect(hostServers(host)).toEqual(untouched(pid))
    })

    await test.step('confirming Use this server switches the machine to that server', async () => {
      await showMachine(page, MACHINE)
      await confirmReuse(page, testInfo.outputPath('reuse-confirmation.png'))
      await expect
        .poll(async () => (await readMachine(page, MACHINE))?.connection, {
          timeout: HOST_ANSWER_TIMEOUT_MS
        })
        .toBe('server')
    })

    await test.step('the desktop talks to the user’s server, which nothing replaced or restarted', async () => {
      const machine = (await readMachine(page, MACHINE))!
      expect(machine.serverInstall).toEqual({ policy: 'never', state: 'declined' })
      expect(await answeringRuntime(page, machine.server!.environmentId)).toBe(runtimeId)
      expect(hostServers(host)).toEqual(untouched(pid))
      const band = page.getByRole('region', { name: 'Seal server' })
      await expect(band).toHaveAttribute('data-machine-server-keeper', 'systemd-user')
      await expect(page.locator('[data-machine-server-action="remove"]')).toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath('reused.png'), animations: 'disabled' })
    })

    await session.close(app)
    app = null

    await test.step('after an app restart the machine reconnects through the same server', async () => {
      const relaunched = await session.launch()
      app = relaunched.app
      await waitForSessionReady(relaunched.page)
      const machine = (await readMachine(relaunched.page, MACHINE))!
      expect(machine.connection).toBe('server')
      await relaunched.page.evaluate(
        (machineId) => window.api.machines!.connect({ machineId }),
        machine.id
      )
      await expect
        .poll(() => answeringRuntime(relaunched.page, machine.server!.environmentId), {
          timeout: 3 * 60_000
        })
        .toBe(runtimeId)
      expect(hostServers(host)).toEqual(untouched(pid))
      await openMachinesPage(relaunched.page)
      await showMachine(relaunched.page, MACHINE)
      await expect(relaunched.page.getByRole('region', { name: 'Seal server' })).toHaveAttribute(
        'data-machine-server-keeper',
        'systemd-user'
      )
      await expect(relaunched.page.locator('[data-machine-server-action="remove"]')).toHaveCount(0)
      await relaunched.page.screenshot({
        path: testInfo.outputPath('reused-after-restart.png'),
        animations: 'disabled'
      })
    })
  } finally {
    try {
      await session.dispose(app ?? undefined)
    } finally {
      host.dispose()
    }
  }
})
