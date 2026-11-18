import type { Page } from '@stablyai/playwright-test'
import type { MachineId } from '../../../src/shared/machines/machine-types'

export type MachineRow = { id: MachineId; ssh: boolean; server: boolean }

export async function listMachines(page: Page): Promise<MachineRow[]> {
  return page.evaluate(async () =>
    (await window.api.machines!.list()).map((machine) => ({
      id: machine.id,
      ssh: machine.ssh !== null,
      server: machine.server !== null
    }))
  )
}

export async function connectRemoteMachines(page: Page): Promise<void> {
  for (const machine of await listMachines(page)) {
    if (machine.id !== 'local') {
      // A machine reached both ways merges into one, so an id listed a moment ago can vanish.
      await page
        .evaluate((machineId) => window.api.machines!.connect({ machineId }), machine.id)
        .catch((error: unknown) => {
          if (!String(error).includes('Unknown machine')) {
            throw error
          }
        })
    }
  }
}

/** Clicks the machine in the list, first leaving the one a narrow window shows in its place. */
export async function selectMachine(page: Page, machineId: MachineId): Promise<void> {
  const back = page.getByRole('button', { name: 'All machines' })
  if (await back.isVisible()) {
    await back.click()
  }
  await page.locator(`[data-machines-page] [data-machine-id="${machineId}"]`).click()
}
