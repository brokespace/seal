// Adds an SSH machine through the Machines page and reads how its Seal server install ended.
import type { Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'
import type { DockerSystemdSshHost } from './docker-ssh-host-systemd-target'
import type { MachineView } from '../../../src/shared/machines/machine-view'

/** A fresh install uploads a runtime and a bundle, starts the server and pairs with it. */
export const SERVER_INSTALL_TIMEOUT_MS = 6 * 60_000

export async function openMachinesPage(page: Page): Promise<void> {
  await page.evaluate(() => window.__store!.getState().setActiveView('machines'))
  await page.waitForSelector('[data-machines-page]')
}

/** Fills Add machine > Connect over SSH and saves; the server box is left as the dialog shows it unless told otherwise. */
export async function addSshMachine(
  page: Page,
  ssh: DockerSystemdSshHost['ssh'],
  label: string,
  options: { installServer?: boolean } = {}
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
    name: /^Install Seal server on this machine \(recommended\)/
  })
  await expect(installServer).toBeChecked()
  if (options.installServer === false) {
    await installServer.click()
    await expect(installServer).not.toBeChecked()
  }
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
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
