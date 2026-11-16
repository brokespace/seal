// Adds an SSH machine through the Machines page and reads how its Seal server install ended.
import type { Locator, Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'
import type { DockerSystemdSshHost } from './docker-ssh-host-systemd-target'
import type { MachineView } from '../../../src/shared/machines/machine-view'

/** A fresh install uploads a runtime and a bundle, starts the server and pairs with it. */
export const SERVER_INSTALL_TIMEOUT_MS = 6 * 60_000

export async function openMachinesPage(page: Page): Promise<void> {
  await page.evaluate(() => window.__store!.getState().setActiveView('machines'))
  await page.waitForSelector('[data-machines-page]')
}

/** The dialog every install opens first: nothing is written on the machine until it is confirmed. */
export function serverInstallConfirmation(page: Page): Locator {
  return page.getByRole('dialog').filter({ hasText: '~/.orca-remote' })
}

export async function confirmServerInstall(page: Page): Promise<void> {
  const confirmation = serverInstallConfirmation(page)
  await confirmation.getByRole('button', { name: 'Install Seal server', exact: true }).click()
  await expect(confirmation).toBeHidden()
}

/** What Seal has written for its server on the host; empty until an install is confirmed. */
export function sealServerFilesOnHost(host: DockerSystemdSshHost): string[] {
  return host
    .exec(
      'ls -A ~/.orca-remote 2>/dev/null; ls ~/.config/systemd/user/seal-server.service 2>/dev/null; true',
      { user: 'seal' }
    )
    .split('\n')
    .filter(Boolean)
}

async function saveSshMachine(
  page: Page,
  ssh: DockerSystemdSshHost['ssh'],
  label: string,
  options: { installServer?: boolean }
): Promise<void> {
  await page.getByRole('button', { name: 'Add machine' }).click()
  await page.getByRole('menuitem', { name: 'Connect over SSH…' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('#add-ssh-label').fill(label)
  await dialog.locator('#add-ssh-host').fill(ssh.host)
  await dialog.locator('#add-ssh-username').fill(ssh.username)
  await dialog.locator('#add-ssh-port').fill(String(ssh.port))
  await dialog.locator('#add-ssh-identity-file').fill(ssh.identityFile)
  const installServer = dialog.getByRole('checkbox', {
    name: /^Install Seal server on this machine/
  })
  await expect(installServer).not.toBeChecked()
  if (options.installServer) {
    await installServer.click()
    await expect(installServer).toBeChecked()
  }
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
}

/** Fills Add machine > Connect over SSH and saves. The server box starts unticked; `installServer` ticks it and confirms the install. */
export async function addSshMachine(
  page: Page,
  ssh: DockerSystemdSshHost['ssh'],
  label: string,
  options: { installServer?: boolean } = {}
): Promise<void> {
  await saveSshMachine(page, ssh, label, options)
  if (options.installServer) {
    await confirmServerInstall(page)
  }
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 30_000 })
}

/** Add machine with the server box ticked, stopped at the install confirmation so a spec can look at it first. */
export async function addSshMachineUpToServerInstallConfirmation(
  page: Page,
  ssh: DockerSystemdSshHost['ssh'],
  label: string
): Promise<Locator> {
  await saveSshMachine(page, ssh, label, { installServer: true })
  const confirmation = serverInstallConfirmation(page)
  await expect(confirmation).toBeVisible({ timeout: 30_000 })
  return confirmation
}

export function readMachine(page: Page, label: string): Promise<MachineView | null> {
  return page.evaluate(
    async (name) =>
      (await window.api.machines!.list()).find((machine) => machine.name === name) ?? null,
    label
  )
}

export type MachineServerSummary = {
  connection: MachineView['connection']
  state: string | null
  manager: string | null
  linger: boolean | null
  reason: string | null
}

/** Null until the machine exists. */
export async function readMachineServer(
  page: Page,
  label: string
): Promise<MachineServerSummary | null> {
  const machine = await readMachine(page, label)
  return machine
    ? {
        connection: machine.connection,
        state: machine.serverInstall?.state ?? null,
        manager: machine.serverInstall?.manager ?? null,
        linger: machine.serverInstall?.linger ?? null,
        reason: machine.serverInstall?.reason ?? null
      }
    : null
}

export async function showMachine(page: Page, label: string): Promise<MachineView> {
  const machine = await readMachine(page, label)
  if (!machine) {
    throw new Error(`No machine named ${label}`)
  }
  const detail = page.locator(`[data-machine-detail="${machine.id}"]`)
  // A narrow window shows the selected machine's page in place of the list.
  if (!(await detail.isVisible())) {
    await page.locator(`[data-machines-page] [data-machine-id="${machine.id}"]`).click()
  }
  await expect(detail).toBeVisible()
  return machine
}

/** Ports that listen on an address other machines can reach. */
export function reachablePorts(host: DockerSystemdSshHost): number[] {
  const ports = host
    .listeningSockets()
    .filter((socket) => !socket.loopback)
    .map((socket) => socket.port)
  return [...new Set(ports)].toSorted((a, b) => a - b)
}
