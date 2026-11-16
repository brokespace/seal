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
  addSshMachine,
  openMachinesPage,
  readMachineServer,
  SERVER_INSTALL_TIMEOUT_MS,
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

    await test.step('the failed install falls back to plain SSH and says why', async () => {
      await addSshMachine(page, host.ssh, MACHINE)
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
      await expect(server).toContainText(
        'Seal server is not installed: no space left on device. This machine still works over SSH.'
      )
      // The plain SSH connection is the one in use: the machine's own files are listed through it.
      await expect(
        page.locator(`[data-machine-explorer="${machine.id}"] [role=treeitem]`, {
          hasText: 'ssh-notes.txt'
        })
      ).toBeVisible({ timeout: 60_000 })
      expect(host.userSystemctl(['is-active', 'seal-server']).stdout).not.toBe('active')
      await page.screenshot({ path: testInfo.outputPath('failed.png') })
    })

    await test.step('Retry install succeeds once the disk has room', async () => {
      host.restoreInstallRoot()
      await page
        .getByRole('region', { name: 'Seal server' })
        .getByRole('button', { name: 'Retry install' })
        .click()
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
      await expect(page.getByRole('region', { name: 'Seal server' })).toContainText(
        'Runs as a system service (systemd)'
      )
      await page.screenshot({ path: testInfo.outputPath('retried.png') })
    })
  } finally {
    try {
      await session.dispose(app ?? undefined)
    } finally {
      host.dispose()
    }
  }
})
