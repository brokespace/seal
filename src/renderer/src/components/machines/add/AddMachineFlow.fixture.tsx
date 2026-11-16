import { defineFixture } from '../../../component-fixtures/component-fixture'
import { toMachineId } from '../../../../../shared/machines/machine-types'
import { AddMachineDialog, type AddMachineRequest } from './AddMachineFlow'

const NEW_SSH_MACHINE: AddMachineRequest = { mode: 'ssh', machineId: null }

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// The dialog is portaled to <body>, outside the fixture frame.
async function clickInDialog(selector: string): Promise<void> {
  await wait(100)
  document.querySelector<HTMLElement>(`[data-add-machine-server-install] ${selector}`)?.click()
  await wait(400)
}

function addMachineFixture(request: AddMachineRequest, interact?: () => Promise<void>) {
  return defineFixture({
    width: 760,
    render: () => (
      <div style={{ height: 660 }}>
        <AddMachineDialog request={request} onClose={() => {}} onAdopted={() => {}} />
      </div>
    ),
    interact
  })
}

export const sshNewMachine = addMachineFixture(NEW_SSH_MACHINE)

export const sshNewMachineAdvanced = addMachineFixture(NEW_SSH_MACHINE, () =>
  clickInDialog('[data-slot="collapsible-trigger"]')
)

export const sshNewMachineUnticked = addMachineFixture(NEW_SSH_MACHINE, () =>
  clickInDialog('[data-slot="checkbox"]')
)

/** SSH details for a machine that already exists: nothing is installed, so nothing is asked. */
export const sshExistingMachine = addMachineFixture({
  mode: 'ssh',
  machineId: toMachineId('kessel-ml'),
  keepConnection: 'server'
})
