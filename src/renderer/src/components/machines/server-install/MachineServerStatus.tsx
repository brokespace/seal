import React, { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Trans } from 'react-i18next'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { PAGE_GUTTER_X } from '@/components/page-layout/PageLayout'
import { Button } from '@/components/ui/button'
import { useMountedRef } from '@/hooks/useMountedRef'
import { i18n } from '@/i18n/i18n'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { MachineView } from '../../../../../shared/machines/machine-view'
import { MachineCopyableCommand } from './MachineCopyableCommand'
import { MachineServerOfferNotice, MachineServerRetryNotice } from './MachineServerInstallNotice'
import { MachineServerRemoveDialog } from './MachineServerRemoveDialog'
import { serverManagerText } from './seal-server-install-copy'
import {
  declineSealServerInstall,
  installSealServerOnMachine
} from './seal-server-install-requests'

// Why untranslated: literal shell commands.
const OWN_SERVER_SERVICE_COMMAND = 'seal serve service install'
const lingerCommand = (username: string | undefined): string =>
  `sudo loginctl enable-linger ${username || '$USER'}`

function Warning({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="flex items-start gap-1.5 text-status-warning-text">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/** Whether Seal's server is on the machine, how it is kept running, and what can be done about it. */
export function MachineServerStatus({
  view,
  onChanged
}: {
  view: MachineView
  onChanged: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const mountedRef = useMountedRef()
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(false)
  const action = view.serverInstallAction
  const install = view.serverInstall
  const installed = view.connection === 'server' && install?.state === 'installed'
  // A server the user runs has no install record; the machine reports how it is kept running.
  const ownService =
    view.connection === 'server' && !installed && action === 'none' ? view.serverKeeper : undefined
  const serviceRemains = view.serverServiceRemains === true
  const removable = installed || serviceRemains
  const title = t('w7.server.title', 'Seal server')

  // The request shows its own error toast; this only ends the busy state and refreshes the page.
  const run = (request: () => Promise<unknown>): void => {
    setBusy(true)
    void request()
      .catch(() => {})
      .finally(() => {
        if (mountedRef.current) {
          setBusy(false)
        }
        onChanged()
      })
  }
  const installServer = (options?: { moveAnyway: boolean }): void =>
    run(() => installSealServerOnMachine(view.id, options))

  const band = (children: React.ReactNode): React.JSX.Element => (
    <section
      aria-label={title}
      data-machine-server={action}
      className={cn('shrink-0 border-b border-border py-2.5', PAGE_GUTTER_X)}
    >
      {children}
    </section>
  )

  if (action === 'installing') {
    return band(
      <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <LoadingSpinner className="size-3.5 shrink-0" />
        {t('w7.server.installing', 'Installing Seal server…')}
      </p>
    )
  }
  if (action === 'retry') {
    return band(
      <MachineServerRetryNotice
        view={view}
        busy={busy}
        onRetry={() => installServer()}
        onMoveAnyway={() => installServer({ moveAnyway: true })}
      />
    )
  }
  if (action === 'offer') {
    return band(
      <MachineServerOfferNotice
        busy={busy}
        onInstall={() => installServer()}
        onDecline={() => run(() => declineSealServerInstall(view.id))}
      />
    )
  }
  if (
    !installed &&
    !ownService &&
    action !== 'install' &&
    action !== 'keep-running' &&
    action !== 'own-server'
  ) {
    return null
  }

  return band(
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
      <h3 className="shrink-0 text-2xs leading-6 font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="min-w-0 flex-1 basis-64 space-y-1.5 py-1 text-xs">
        {installed ? (
          <p>
            {serverManagerText(t, install.manager)}
            {install.version ? (
              <span className="text-muted-foreground">
                {' · '}
                {t('w7.server.version', 'Version {{version}}', { version: install.version })}
              </span>
            ) : null}
          </p>
        ) : ownService ? (
          <p>{serverManagerText(t, ownService)}</p>
        ) : serviceRemains ? (
          <Warning>
            {t(
              'w7.server.serviceRemains',
              'Seal server was stopped, but its service is still registered on this machine. Remove it again to finish.'
            )}
          </Warning>
        ) : action === 'install' ? (
          <p className="text-muted-foreground">
            {t('w7.server.notInstalled', 'Not installed on this machine')}
          </p>
        ) : action === 'keep-running' ? (
          <p>{t('w7.server.notService', 'Not kept running as a service')}</p>
        ) : null}
        {installed && install.manager === 'systemd-user' && install.linger === false ? (
          <>
            <Warning>
              {t(
                'w7.server.lingerOff',
                'It stops when you log out of the machine and does not start after a reboot. To fix that, run this on the machine:'
              )}
            </Warning>
            <MachineCopyableCommand command={lingerCommand(view.ssh?.username)} />
          </>
        ) : null}
        {installed && install.manager === 'pm2' && view.serverStartsAtBoot === false ? (
          <Warning>
            <Trans
              i18n={i18n}
              defaults={t(
                'w7.server.pm2NoBoot',
                'PM2 is not set to start at boot on this machine. Run <code>pm2 startup</code> there to keep the server across reboots.'
              )}
              components={{ code: <code className="rounded bg-muted px-1 py-0.5 font-mono" /> }}
            />
          </Warning>
        ) : null}
        {action === 'keep-running' ? (
          <p className="text-muted-foreground">
            {t(
              'w7.server.keepRunningHelp',
              'As a service it keeps running when this computer disconnects and starts again after a reboot.'
            )}
          </p>
        ) : null}
        {action === 'own-server' ? (
          <>
            <p className="text-muted-foreground">
              {t(
                'w7.server.ownServer',
                'To keep this server running after a reboot, run this on the machine:'
              )}
            </p>
            <MachineCopyableCommand command={OWN_SERVER_SERVICE_COMMAND} />
          </>
        ) : null}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {action === 'install' || action === 'keep-running' ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={() => installServer()}
          >
            {action === 'install'
              ? t('w7.server.install', 'Install Seal server')
              : t('w7.server.keepRunning', 'Keep it running as a service')}
          </Button>
        ) : null}
        {removable ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => setRemoving(true)}
          >
            {t('w7.remove.action', 'Remove Seal server…')}
          </Button>
        ) : null}
      </div>
      {removable ? (
        <MachineServerRemoveDialog
          view={view}
          open={removing}
          onOpenChange={setRemoving}
          onRemoved={onChanged}
        />
      ) : null}
    </div>
  )
}
