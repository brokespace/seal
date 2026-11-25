import { defineFixture } from '../../../../component-fixtures/component-fixture'
import type { SshTarget } from '../../../../../../shared/ssh-types'
import { ConfirmationDialogProvider } from '../../../confirmation-dialog'
import { fakeMachinesApi } from '../../../machines/machine-api-fixture'
import {
  SERVER_INSTALL_FIXTURE_IDS,
  SERVER_INSTALL_FIXTURE_MACHINES
} from '../../../machines/machine-server-install-fixture-data'
import { RuntimeInstallServerDialog } from './runtime-install-server-dialog'

const TARGETS: SshTarget[] = SERVER_INSTALL_FIXTURE_MACHINES.flatMap((machine) =>
  machine.ssh
    ? [
        {
          id: machine.ssh.targetId,
          label: machine.name,
          host: machine.ssh.host,
          port: machine.ssh.port,
          username: machine.ssh.username
        }
      ]
    : []
)

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Settings' "Set up Seal on an SSH host" with one host chosen; `press` opens what its button asks. */
function installDialogFixture(
  key: keyof typeof SERVER_INSTALL_FIXTURE_IDS | null,
  press?: 'install' | 'reuse'
) {
  return defineFixture({
    width: 760,
    setup: () => {
      window.api.machines = {
        ...fakeMachinesApi,
        list: async () => SERVER_INSTALL_FIXTURE_MACHINES
      }
    },
    render: () => (
      <ConfirmationDialogProvider>
        <div style={{ height: 620 }}>
          <RuntimeInstallServerDialog
            open
            emptyTargets={TARGETS}
            loadFailed={false}
            onOpenChange={() => {}}
            onDeployed={() => {}}
          />
        </div>
      </ConfirmationDialogProvider>
    ),
    interact: async () => {
      await wait(100)
      document.querySelector<HTMLElement>('[role="combobox"]')?.click()
      await wait(150)
      if (key) {
        document
          .querySelector<HTMLElement>(
            `[cmdk-item][data-value="${SERVER_INSTALL_FIXTURE_IDS[key]}"]`
          )
          ?.click()
        await wait(150)
      }
      if (press) {
        document.querySelector<HTMLElement>(`[data-machine-server-action="${press}"]`)?.click()
        await wait(300)
      }
    }
  })
}

/** The host list leaves out machines that already connect through a Seal server. */
export const hosts = installDialogFixture(null)
export const hostChosen = installDialogFixture('install')
export const confirmation = installDialogFixture('install', 'install')
export const ownServer = installDialogFixture('reuse')
export const ownServerDialog = installDialogFixture('reuse', 'reuse')
export const installing = installDialogFixture('installing')
export const waitsForHost = installDialogFixture('waitsForHost')
