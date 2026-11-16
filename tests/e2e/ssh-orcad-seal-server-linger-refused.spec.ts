// A systemd host that refuses lingering to its user still gets Seal server as a user service; the machine's
// page gives the command that turns lingering on, and the server stops when the user's last session ends.
// Needs Docker with cgroup v2 and ORCA_E2E_ORCAD_CONVERT_TEMPLATE built for linux-x64-glibc.
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import {
  dockerSystemdSshHostUnavailableReason,
  startDockerSystemdSshHost
} from './helpers/docker-ssh-host-systemd-target'
import {
  addSshMachine,
  openMachinesPage,
  readMachine,
  readMachineServer,
  reconnectThroughServer,
  SEAL_SERVICE_PORT,
  SERVER_INSTALL_TIMEOUT_MS,
  showMachine
} from './helpers/seal-server-install-machine'

const TEMPLATE = process.env.ORCA_E2E_ORCAD_CONVERT_TEMPLATE
const UNAVAILABLE = dockerSystemdSshHostUnavailableReason()
const MACHINE = 'seal-e2e-linger-refused-box'
// A second login name for the host's `seal` account, so the SSH details do not carry the name `id -un` gives.
const SSH_LOGIN = 'seal-ssh-login'

test.skip(UNAVAILABLE !== null || !TEMPLATE, UNAVAILABLE ?? 'Set ORCA_E2E_ORCAD_CONVERT_TEMPLATE')

async function expectLingerWarning(page: Page): Promise<void> {
  await showMachine(page, MACHINE)
  const server = page.getByRole('region', { name: 'Seal server' })
  await expect(server.locator('[data-machine-server-warning="linger-off"]')).toBeVisible()
  await expect(server.getByText('sudo loginctl enable-linger seal', { exact: true })).toBeVisible()
}

test('a host that refuses lingering runs Seal server only while its user has a session there', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its app launches and its host.
{}, testInfo) => {
  // Boots a systemd host, installs a server on it and launches the app twice.
  test.setTimeout(20 * 60_000)
  const host = await startDockerSystemdSshHost(testInfo, { polkit: false })
  const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: TEMPLATE! })
  let app: ElectronApplication | null = null
  try {
    host.exec(
      `useradd --non-unique --uid "$(id -u seal)" --gid seal --home-dir /home/seal --no-create-home --shell /bin/bash ${SSH_LOGIN}`
    )
    const first = await session.launch()
    app = first.app
    await waitForSessionReady(first.page)
    await openMachinesPage(first.page)

    await test.step('the install ends as a systemd user service without lingering', async () => {
      await addSshMachine(first.page, { ...host.ssh, username: SSH_LOGIN }, MACHINE, {
        installServer: true
      })
      await expect
        .poll(() => readMachineServer(first.page, MACHINE), { timeout: SERVER_INSTALL_TIMEOUT_MS })
        .toEqual({
          connection: 'server',
          state: 'installed',
          manager: 'systemd-user',
          linger: false,
          reason: null
        })
      expect(host.userSystemctl(['is-active', 'seal-server']).stdout).toBe('active')
      expect(host.lingerEnabled()).toBe(false)
      const serverPid = host.loopbackListenerPid(SEAL_SERVICE_PORT)
      expect(serverPid).not.toBeNull()
      expect(host.sealServerState()).toEqual({ serviceActive: true, processIds: [serverPid] })
    })

    await test.step('the machine page gives the linger command for the account the host names', async () => {
      expect((await readMachine(first.page, MACHINE))!.serverHostUser).toBe('seal')
      await expectLingerWarning(first.page)
      await first.page.screenshot({
        path: testInfo.outputPath('linger-warning.png'),
        animations: 'disabled'
      })
    })

    await session.close(app)
    app = null

    // Only `docker exec` reads from here on: a login would start the user's manager and the server again.
    await test.step('the server stops once the account has no session left on the host', async () => {
      // Seal's disk index daemon stays in the SSH login's session and holds it open after the logout.
      for (const login of host.loginSessions()) {
        host.exec(`loginctl kill-session ${login.split(' ')[0]} --signal=SIGKILL`)
      }
      await expect.poll(() => host.loginSessions(), { timeout: 30_000 }).toEqual([])
      await expect
        .poll(() => host.sealServerState(), { timeout: 45_000, intervals: [1_000] })
        .toEqual({ serviceActive: false, processIds: [] })
      expect(host.lingerEnabled()).toBe(false)
    })

    await test.step('the next connect starts the server again and the warning stays', async () => {
      const second = await session.launch()
      app = second.app
      await reconnectThroughServer(second.page, MACHINE)
      expect(host.sealServerState().serviceActive).toBe(true)
      expect(host.lingerEnabled()).toBe(false)
      await openMachinesPage(second.page)
      await expectLingerWarning(second.page)
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
