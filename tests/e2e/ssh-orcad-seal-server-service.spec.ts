// T7.1 and T7.2: a new SSH machine gets Seal server as a systemd user service with linger, and a host restart
// brings the server back before any desktop connects. Settings' own way to install asks first too.
// Needs Docker with cgroup v2 and ORCA_E2E_ORCAD_CONVERT_TEMPLATE built for linux-x64-glibc.
import type { ElectronApplication, Locator, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import {
  dockerSystemdSshHostUnavailableReason,
  startDockerSystemdSshHost,
  type DockerSystemdSshHost
} from './helpers/docker-ssh-host-systemd-target'
import {
  addSshMachine,
  addSshMachineUpToServerInstallConfirmation,
  confirmServerInstall,
  openMachinesPage,
  reachablePorts,
  readMachine,
  readMachineServer,
  sealServerFilesOnHost,
  SERVER_INSTALL_TIMEOUT_MS,
  serverInstallConfirmation,
  showMachine
} from './helpers/seal-server-install-machine'

const TEMPLATE = process.env.ORCA_E2E_ORCAD_CONVERT_TEMPLATE
const UNAVAILABLE = dockerSystemdSshHostUnavailableReason()
const MACHINE = 'seal-e2e-service-box'
const SETTINGS_MACHINE = 'seal-e2e-settings-box'
// A server run as a service keeps off 6768, the port the user's own `seal serve` takes.
const SERVER_PORT = 16768
const OWN_SERVE_PORT = 6768
const NOTES_FILE = 'service-notes.txt'

test.skip(UNAVAILABLE !== null || !TEMPLATE, UNAVAILABLE ?? 'Set ORCA_E2E_ORCAD_CONVERT_TEMPLATE')

function listensOn(host: DockerSystemdSshHost, port: number): { loopback: boolean }[] {
  return host
    .listeningSockets()
    .filter((socket) => socket.port === port)
    .map(({ loopback }) => ({ loopback }))
}

/** A TCP connect from inside the host, made by root so no login session appears for the SSH user. */
function serverAcceptsOnLoopback(host: DockerSystemdSshHost): boolean {
  try {
    return host.exec(`exec 3<>/dev/tcp/127.0.0.1/${SERVER_PORT} && echo open`) === 'open'
  } catch {
    return false
  }
}

async function serverListsSessions(page: Page, environmentId: string): Promise<boolean> {
  return page.evaluate(async (selector) => {
    const response = await window.api.runtimeEnvironments.call({
      selector,
      method: 'terminal.list',
      params: {}
    })
    return response.ok
  }, environmentId)
}

/** Settings > Machines > Seal servers > "Set up Seal on an SSH host"; returns that dialog. */
async function openSettingsServerSetup(page: Page): Promise<Locator> {
  await page.evaluate(() => {
    const state = window.__store!.getState()
    state.openSettingsTarget({ pane: 'machines', repoId: null })
    state.openSettingsPage()
  })
  await page.getByRole('button', { name: 'SSH keys, port forwards and server pairing' }).click()
  await page.getByRole('button', { name: 'More ways to add a server' }).click()
  await page.getByRole('menuitem', { name: /Set up Seal on an SSH host/ }).click()
  const setup = page
    .getByRole('dialog')
    .filter({ has: page.locator('[data-machine-server-action="install"]') })
  await expect(setup).toBeVisible()
  return setup
}

test('a new SSH machine runs Seal server as a service that a host restart brings back', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its app launches and its host.
{}, testInfo) => {
  // Boots a systemd host, installs a server on it, restarts the host and launches the app twice.
  test.setTimeout(20 * 60_000)
  const host = await startDockerSystemdSshHost(testInfo)
  const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: TEMPLATE! })
  let app: ElectronApplication | null = null
  try {
    host.exec(`printf "on the host\\n" > ~/${NOTES_FILE}`, { user: 'seal' })
    const first = await session.launch()
    app = first.app
    await waitForSessionReady(first.page)
    await openMachinesPage(first.page)

    await test.step('Add machine with the server box ticked asks before it writes anything', async () => {
      await addSshMachineUpToServerInstallConfirmation(first.page, host.ssh, MACHINE)
      expect((await readMachine(first.page, MACHINE))?.connection).toBe('ssh')
      expect(sealServerFilesOnHost(host)).toEqual([])
      expect(host.lingerEnabled()).toBe(false)
      await first.page.screenshot({
        path: testInfo.outputPath('install-confirmation.png'),
        animations: 'disabled'
      })
    })

    await test.step('confirming installs the server as a systemd user service', async () => {
      await confirmServerInstall(first.page)
      await expect
        .poll(() => readMachineServer(first.page, MACHINE), { timeout: SERVER_INSTALL_TIMEOUT_MS })
        .toEqual({
          connection: 'server',
          state: 'installed',
          manager: 'systemd-user',
          linger: true,
          reason: null
        })
      expect(sealServerFilesOnHost(host)).not.toEqual([])
      expect(host.userSystemctl(['is-active', 'seal-server']).stdout).toBe('active')
      expect(host.userSystemctl(['is-enabled', 'seal-server']).stdout).toBe('enabled')
      expect(host.lingerEnabled()).toBe(true)
      expect(listensOn(host, SERVER_PORT)).toEqual([{ loopback: true }])
      expect(listensOn(host, OWN_SERVE_PORT)).toEqual([])
      // Only sshd is reachable from outside the host: the server opened no port.
      expect(reachablePorts(host)).toEqual([22])
      await showMachine(first.page, MACHINE)
      await expect(first.page.getByRole('region', { name: 'Seal server' })).toHaveAttribute(
        'data-machine-server-keeper',
        'systemd-user'
      )
      await expect(first.page.locator('[data-machine-server-warning]')).toHaveCount(0)
      await first.page.screenshot({
        path: testInfo.outputPath('installed.png'),
        animations: 'disabled'
      })
    })

    await session.close(app)
    app = null

    let serverPid: number | null = null
    await test.step('after a host restart the server runs before any desktop connects', async () => {
      host.restart()
      await expect
        .poll(() => host.userSystemctl(['is-active', 'seal-server']).stdout, { timeout: 90_000 })
        .toBe('active')
      await expect.poll(() => serverAcceptsOnLoopback(host), { timeout: 90_000 }).toBe(true)
      expect(listensOn(host, OWN_SERVE_PORT)).toEqual([])
      // Nobody logged in: linger started the user's manager, and the manager started the server.
      expect(host.loginSessions()).toEqual([])
      expect(reachablePorts(host)).toEqual([22])
      serverPid = host.loopbackListenerPid(SERVER_PORT)
      expect(serverPid).not.toBeNull()
    })

    await test.step('the desktop reconnects through the server and lists its sessions', async () => {
      const second = await session.launch()
      app = second.app
      await waitForSessionReady(second.page)
      const machine = (await readMachine(second.page, MACHINE))!
      expect(machine.connection).toBe('server')
      await second.page.evaluate(
        (machineId) => window.api.machines!.connect({ machineId }),
        machine.id
      )
      await expect
        .poll(() => serverListsSessions(second.page, machine.server!.environmentId), {
          timeout: 3 * 60_000
        })
        .toBe(true)
      await second.page.evaluate(() => window.api.liveSessions.refresh())
      const sessions = await second.page.evaluate(() => window.api.liveSessions.snapshot())
      expect(sessions.hostErrors[machine.recordId]).toBeUndefined()
      // The reconnect reused the running service instead of starting the server a second time.
      expect(host.userSystemctl(['show', 'seal-server', '-p', 'NRestarts', '--value']).stdout).toBe(
        '0'
      )
      expect(host.loopbackListenerPid(SERVER_PORT)).toBe(serverPid)
      await openMachinesPage(second.page)
      const shown = await showMachine(second.page, MACHINE)
      await expect(second.page.getByRole('region', { name: 'Seal server' })).toHaveAttribute(
        'data-machine-server-keeper',
        'systemd-user'
      )
      // The machine's own files are listed through the server that came back.
      await expect(
        second.page.locator(`[data-machine-explorer="${shown.id}"] [role=treeitem]`, {
          hasText: NOTES_FILE
        })
      ).toBeVisible({ timeout: 60_000 })
      await second.page.screenshot({
        path: testInfo.outputPath('reconnected.png'),
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

test('Settings installs Seal server on an SSH host only after the confirmation', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its app launch and its host.
{}, testInfo) => {
  // Boots a systemd host and installs a server on it.
  test.setTimeout(15 * 60_000)
  const host = await startDockerSystemdSshHost(testInfo)
  const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: TEMPLATE! })
  let app: ElectronApplication | null = null
  try {
    const launched = await session.launch()
    app = launched.app
    const { page } = launched
    await waitForSessionReady(page)
    await openMachinesPage(page)
    await addSshMachine(page, host.ssh, SETTINGS_MACHINE)
    const setup = await openSettingsServerSetup(page)
    const install = setup.locator('[data-machine-server-action="install"]')
    const confirmation = serverInstallConfirmation(page)
    const listedServer = page
      .locator('[data-settings-section="managed-servers"]')
      .filter({ hasText: SETTINGS_MACHINE })

    await test.step('"Install Seal server…" in Settings asks before it writes anything', async () => {
      await setup.getByRole('combobox').click()
      await page.getByRole('option', { name: SETTINGS_MACHINE }).click()
      await page.screenshot({
        path: testInfo.outputPath('settings-install-dialog.png'),
        animations: 'disabled'
      })
      await install.click()
      await expect(confirmation).toBeVisible()
      expect(sealServerFilesOnHost(host)).toEqual([])
      await page.screenshot({
        path: testInfo.outputPath('settings-install-confirmation.png'),
        animations: 'disabled'
      })
    })

    await test.step('Cancel leaves the host untouched and the machine on plain SSH', async () => {
      await confirmation.getByRole('button', { name: 'Cancel' }).click()
      await expect(confirmation).toBeHidden()
      // The button is disabled while an install runs for the chosen host.
      await expect(install).toBeEnabled()
      expect(sealServerFilesOnHost(host)).toEqual([])
      expect(await readMachine(page, SETTINGS_MACHINE)).toMatchObject({
        connection: 'ssh',
        serverInstallAction: 'install'
      })
      await expect(listedServer).toHaveCount(0)
    })

    await test.step('confirming installs the server and Settings lists it', async () => {
      await install.click()
      await confirmServerInstall(page)
      await expect
        .poll(() => readMachineServer(page, SETTINGS_MACHINE), {
          timeout: SERVER_INSTALL_TIMEOUT_MS
        })
        .toEqual({
          connection: 'server',
          state: 'installed',
          manager: 'systemd-user',
          linger: true,
          reason: null
        })
      expect(sealServerFilesOnHost(host)).not.toEqual([])
      expect(listensOn(host, SERVER_PORT)).toEqual([{ loopback: true }])
      expect(listensOn(host, OWN_SERVE_PORT)).toEqual([])
      await expect(setup).toBeHidden()
      await expect(listedServer).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath('settings-server-listed.png'),
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
