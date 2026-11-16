// T7.4 (no space): an install that fails leaves the machine working over plain SSH with the reason on its
// page, and "Retry install" succeeds once the cause is gone. Needs Docker with cgroup v2 and
// ORCA_E2E_ORCAD_CONVERT_TEMPLATE built for linux-x64-glibc.
import type { ElectronApplication } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import {
  dockerSystemdSshHostUnavailableReason,
  startDockerSystemdSshHost
} from './helpers/docker-ssh-host-systemd-target'
import {
  addSshMachineUpToServerInstallConfirmation,
  confirmServerInstall,
  openMachinesPage,
  readMachineServer,
  sealServerFilesOnHost,
  SERVER_INSTALL_TIMEOUT_MS,
  serverInstallConfirmation,
  showMachine
} from './helpers/seal-server-install-machine'

const TEMPLATE = process.env.ORCA_E2E_ORCAD_CONVERT_TEMPLATE
const UNAVAILABLE = dockerSystemdSshHostUnavailableReason()
const MACHINE = 'seal-e2e-full-disk-box'

test.skip(UNAVAILABLE !== null || !TEMPLATE, UNAVAILABLE ?? 'Set ORCA_E2E_ORCAD_CONVERT_TEMPLATE')

test('a machine with no space for Seal server works over SSH and installs on retry', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its app launch and its host.
{}, testInfo) => {
  // Boots a systemd host and runs the install twice: once into a full disk, once for real.
  test.setTimeout(20 * 60_000)
  const host = await startDockerSystemdSshHost(testInfo)
  const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: TEMPLATE! })
  let app: ElectronApplication | null = null
  try {
    host.exec('printf "over ssh\\n" > ~/ssh-notes.txt', { user: 'seal' })
    host.makeInstallRootOutOfSpace()
    const launched = await session.launch()
    app = launched.app
    const { page } = launched
    await waitForSessionReady(page)
    await openMachinesPage(page)

    await test.step('Add machine with the server box ticked asks before it writes anything', async () => {
      await addSshMachineUpToServerInstallConfirmation(page, host.ssh, MACHINE)
      expect(sealServerFilesOnHost(host)).toEqual([])
      await page.screenshot({
        path: testInfo.outputPath('install-confirmation.png'),
        animations: 'disabled'
      })
    })

    await test.step('the failed install falls back to plain SSH and says why', async () => {
      await confirmServerInstall(page)
      await expect
        .poll(() => readMachineServer(page, MACHINE), { timeout: SERVER_INSTALL_TIMEOUT_MS })
        .toEqual({
          connection: 'ssh',
          state: 'failed',
          manager: null,
          linger: null,
          reason: 'no space left on device'
        })
      const machine = await showMachine(page, MACHINE)
      const server = page.getByRole('region', { name: 'Seal server' })
      await expect(server).toHaveAttribute('data-machine-server', 'retry')
      await expect(server).toContainText('no space left on device')
      // The plain SSH connection is the one in use: the machine's own files are listed through it.
      await expect(
        page.locator(`[data-machine-explorer="${machine.id}"] [role=treeitem]`, {
          hasText: 'ssh-notes.txt'
        })
      ).toBeVisible({ timeout: 60_000 })
      expect(host.userSystemctl(['is-active', 'seal-server']).stdout).not.toBe('active')
      await page.screenshot({ path: testInfo.outputPath('failed.png'), animations: 'disabled' })
    })

    await test.step('Retry install asks again before it writes anything', async () => {
      host.restoreInstallRoot()
      await page
        .locator('[data-machine-server="retry"] [data-machine-server-action="retry"]')
        .click()
      await expect(serverInstallConfirmation(page)).toBeVisible()
      expect(sealServerFilesOnHost(host)).toEqual([])
      expect((await readMachineServer(page, MACHINE))?.state).toBe('failed')
      await page.screenshot({
        path: testInfo.outputPath('retry-confirmation.png'),
        animations: 'disabled'
      })
    })

    await test.step('the confirmed retry succeeds once the disk has room', async () => {
      await confirmServerInstall(page)
      await expect
        .poll(() => readMachineServer(page, MACHINE), { timeout: SERVER_INSTALL_TIMEOUT_MS })
        .toEqual({
          connection: 'server',
          state: 'installed',
          manager: 'systemd-user',
          linger: true,
          reason: null
        })
      expect(host.userSystemctl(['is-active', 'seal-server']).stdout).toBe('active')
      await expect(page.getByRole('region', { name: 'Seal server' })).toHaveAttribute(
        'data-machine-server-keeper',
        'systemd-user'
      )
      await page.screenshot({ path: testInfo.outputPath('retried.png'), animations: 'disabled' })
    })
  } finally {
    try {
      await session.dispose(app ?? undefined)
    } finally {
      host.dispose()
    }
  }
})
