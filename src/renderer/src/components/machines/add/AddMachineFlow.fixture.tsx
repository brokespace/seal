import { defineFixture } from '../../../component-fixtures/component-fixture'
import { toMachineId } from '../../../../../shared/machines/machine-types'
import { ConfirmationDialogProvider } from '../../confirmation-dialog'
import { AddMachineDialog, type AddMachineRequest } from './AddMachineFlow'

const NEW_SSH_MACHINE: AddMachineRequest = { mode: 'ssh', machineId: null }

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// The dialog is portaled to <body>, outside the fixture frame.
async function clickInDialog(selector: string): Promise<void> {
  await wait(100)
  document.querySelector<HTMLElement>(`[role="dialog"] ${selector}`)?.click()
  await wait(400)
}

function addMachineFixture(request: AddMachineRequest, interact?: () => Promise<void>) {
  return defineFixture({
    width: 760,
    render: () => (
      <ConfirmationDialogProvider>
        <div style={{ height: 660 }}>
          <AddMachineDialog request={request} onClose={() => {}} onAdopted={() => {}} />
        </div>
      </ConfirmationDialogProvider>
    ),
    interact
  })
}

const tickInstall = (): Promise<void> =>
  clickInDialog('[data-add-machine-server-install] [data-slot="checkbox"]')

async function openAdvanced(scroll: 'top' | 'bottom'): Promise<void> {
  await clickInDialog('[data-slot="collapsible-trigger"]')
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  dialog?.scrollTo({ top: scroll === 'bottom' ? dialog.scrollHeight : 0 })
  await wait(100)
}

/** The box starts unticked: nothing is installed unless the user asks. */
export const sshNewMachine = addMachineFixture(NEW_SSH_MACHINE)

export const sshNewMachineTicked = addMachineFixture(NEW_SSH_MACHINE, tickInstall)

/** The service manager choices show only with the box ticked. */
export const sshNewMachineAdvanced = addMachineFixture(NEW_SSH_MACHINE, async () => {
  await tickInstall()
  await openAdvanced('bottom')
})

export const sshNewMachineAdvancedUnticked = addMachineFixture(NEW_SSH_MACHINE, () =>
  openAdvanced('bottom')
)

/** SSH details for a machine that already exists: nothing is installed, so nothing is asked. */
export const sshExistingMachine = addMachineFixture({
  mode: 'ssh',
  machineId: toMachineId('kessel-ml'),
  keepConnection: 'server'
})
