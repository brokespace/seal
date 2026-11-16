import { useEffect } from 'react'
import { defineFixture } from '../../../component-fixtures/component-fixture'
import { toMachineId } from '../../../../../shared/machines/machine-types'
import { ConfirmationDialogProvider } from '../../confirmation-dialog'
import { useSealServerInstall, type SealServerInstallOptions } from './use-seal-server-install'

function AskOnMount({ options }: { options: SealServerInstallOptions }): null {
  const installServer = useSealServerInstall()
  useEffect(() => {
    void installServer({ id: toMachineId('build-01'), name: 'build-01' }, options)
  }, [installServer, options])
  return null
}

/** The dialog every install entry point opens, for one choice of service manager. */
function installDialogFixture(options: SealServerInstallOptions) {
  return defineFixture({
    width: 760,
    render: () => (
      <ConfirmationDialogProvider>
        <div style={{ height: 620 }}>
          <AskOnMount options={options} />
        </div>
      </ConfirmationDialogProvider>
    ),
    interact: () => new Promise((resolve) => setTimeout(resolve, 300))
  })
}

export const automatic = installDialogFixture({})
export const systemd = installDialogFixture({ manager: 'systemd-user' })
export const pm2 = installDialogFixture({ manager: 'pm2' })
export const launchd = installDialogFixture({ manager: 'launchd' })
export const moveAnyway = installDialogFixture({ moveAnyway: true })
export const keepRunning = installDialogFixture({ purpose: 'keep-running' })
export const keepRunningLaunchd = installDialogFixture({
  purpose: 'keep-running',
  manager: 'launchd'
})
