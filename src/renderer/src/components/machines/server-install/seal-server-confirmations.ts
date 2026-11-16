import type { ConfirmationDialogOptions } from '@/components/confirmation-dialog-context'
import type { Translate } from '@/i18n/use-translate'
import type { MachineServiceManagerChoice } from '../../../../../shared/machines/machine-view'

export type SealServerInstallPurpose = 'install' | 'keep-running'

// The shared dialog keeps line breaks, so a blank line makes each fact its own paragraph.
function confirmation(
  options: Pick<ConfirmationDialogOptions, 'title' | 'confirmLabel' | 'confirmVariant'>,
  paragraphs: (string | null)[]
): ConfirmationDialogOptions {
  return {
    ...options,
    surface: 'security',
    description: paragraphs.filter((paragraph) => paragraph !== null).join('\n\n'),
    descriptionClassName: 'scrollbar-sleek max-h-[60vh] overflow-y-auto leading-relaxed'
  }
}

function serviceTexts(t: Translate, manager: MachineServiceManagerChoice): string[] {
  switch (manager) {
    case 'auto':
      return [
        t(
          'seal.machineServer.installDialog.serviceAuto',
          'Seal registers a user service that keeps the server running: PM2 when the machine has PM2, otherwise a systemd user service. When the machine has neither, no service is registered, and the server starts when Seal connects and stops when idle.'
        )
      ]
    case 'systemd-user':
      return [
        t(
          'seal.machineServer.installDialog.serviceSystemd',
          'Seal registers a systemd user service that keeps the server running, as chosen under Advanced. When the machine cannot run one, Seal uses PM2 when the machine has it.'
        )
      ]
    case 'pm2':
      return [
        t(
          'seal.machineServer.installDialog.servicePm2',
          'Seal registers the server with PM2, which keeps it running, as chosen under Advanced. When the machine has no PM2, Seal registers a systemd user service instead.'
        )
      ]
    case 'launchd':
      return [
        t(
          'seal.machineServer.installDialog.serviceLaunchd',
          'Seal registers a launchd user service (experimental) that keeps the server running, as chosen under Advanced. launchd starts the server when you log in at the Mac’s screen, so the server does not run on a Mac nobody logs in to.'
        ),
        t(
          'seal.machineServer.installDialog.serviceLaunchdFallback',
          'When no one is logged in at the screen during the install, no service is registered, and the server starts when Seal connects and stops when idle. On a machine without launchd, Seal chooses as it does automatically: PM2 when the machine has PM2, otherwise a systemd user service.'
        )
      ]
  }
}

function lingerText(t: Translate): string {
  return t(
    'seal.machineServer.installDialog.linger',
    'With systemd, Seal asks the machine to turn on lingering for your account, so the service keeps running after this computer disconnects.'
  )
}

function laterRemovalText(t: Translate): string {
  return t(
    'seal.machineServer.installDialog.laterRemoval',
    'Later, “Remove Seal server” stops the server and removes the service. Lingering and the files in ~/.orca-remote stay on the machine.'
  )
}

/** What an install, or registering a running server as a service, writes on the machine. */
export function sealServerInstallConfirmation(
  t: Translate,
  name: string,
  options: {
    purpose?: SealServerInstallPurpose
    manager?: MachineServiceManagerChoice
    moveAnyway?: boolean
  }
): ConfirmationDialogOptions {
  if (options.purpose === 'keep-running') {
    return confirmation(
      {
        title: t(
          'seal.machineServer.keepRunningDialog.title',
          'Keep Seal server running on {{name}} as a service?',
          { name }
        ),
        confirmLabel: t('seal.machineServer.server.keepRunning', 'Keep it running as a service')
      },
      options.manager === 'launchd'
        ? [
            t(
              'seal.machineServer.keepRunningDialog.serviceLaunchd',
              'Seal registers the server that already runs on {{name}} as a launchd user service (experimental) and restarts the server once. launchd starts the server when you log in at the Mac’s screen, so the server does not run on a Mac nobody logs in to. When no one is logged in at the screen now, no service is registered.',
              { name }
            ),
            laterRemovalText(t)
          ]
        : [
            t(
              'seal.machineServer.keepRunningDialog.service',
              'Seal registers the server that already runs on {{name}} as a user service and restarts the server once. The service is PM2 when the machine has PM2, otherwise a systemd user service.',
              { name }
            ),
            lingerText(t),
            laterRemovalText(t)
          ]
    )
  }
  return confirmation(
    {
      title: t('seal.machineServer.installDialog.title', 'Install Seal server on {{name}}?', {
        name
      }),
      confirmLabel: t('seal.machineServer.server.install', 'Install Seal server')
    },
    [
      t(
        'seal.machineServer.installDialog.files',
        'Seal writes its server files to ~/.orca-remote on {{name}}, then connects to {{name}} through the server instead of plain SSH.',
        { name }
      ),
      options.moveAnyway
        ? t(
            'seal.machineServer.installDialog.moveAnyway',
            'The saved items listed on this machine’s page stay on this computer and do not appear on {{name}}.',
            { name }
          )
        : null,
      ...serviceTexts(t, options.manager ?? 'auto'),
      lingerText(t),
      laterRemovalText(t)
    ]
  )
}

/** Connecting through the `seal serve` service the machine's user already runs. */
export function ownSealServerReuseConfirmation(
  t: Translate,
  name: string
): ConfirmationDialogOptions {
  return confirmation(
    {
      title: t(
        'seal.machineServer.reuseDialog.title',
        'Use the Seal server that already runs on {{name}}?',
        { name }
      ),
      confirmLabel: t('seal.machineServer.reuseDialog.confirm', 'Use this server')
    },
    [
      t(
        'seal.machineServer.reuseDialog.connects',
        'Seal connects to {{name}} through the server that already runs there. Over SSH, Seal asks that server for an access link with “seal pair”, then reaches the server through an SSH tunnel.',
        { name }
      ),
      t(
        'seal.machineServer.reuseDialog.nothingInstalled',
        'Nothing is installed on {{name}}, and the server is not restarted.',
        { name }
      )
    ]
  )
}

export function sealServerRemovalConfirmation(
  t: Translate,
  name: string
): ConfirmationDialogOptions {
  return confirmation(
    {
      title: t('seal.machineServer.remove.title', 'Remove Seal server from {{name}}?', { name }),
      confirmLabel: t('seal.machineServer.remove.confirm', 'Remove Seal server'),
      confirmVariant: 'destructive'
    },
    [
      t(
        'seal.machineServer.remove.stops',
        'This stops Seal server on {{name}} and removes its service. {{name}} goes back to a plain SSH connection, and projects and sessions opened through the server are no longer shown on this computer.',
        { name }
      ),
      t(
        'seal.machineServer.remove.stays',
        'Lingering, the files under ~/.orca-remote and your project files stay on the machine.'
      ),
      t(
        'seal.machineServer.remove.terminals',
        'Running terminals block the removal: close the terminals that run through the server first.'
      )
    ]
  )
}
