import React, { useState } from 'react'
import {
  useConfirmationDialog,
  type ConfirmationDialogOptions
} from '@/components/confirmation-dialog-context'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { PAGE_GUTTER_X } from '@/components/page-layout/PageLayout'
import { Button } from '@/components/ui/button'
import { useMountedRef } from '@/hooks/useMountedRef'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { MachinesApi } from '../../../../../preload/api/machines/machines-bridge'
import type { MachineView } from '../../../../../shared/machines/machine-view'
import { MachineCopyableCommand } from './MachineCopyableCommand'
import {
  MachineServerOfferNotice,
  MachineServerRetryNotice,
  MachineServerReuseNotice
} from './MachineServerInstallNotice'
import { MachineServerKeeperNotes, MachineServerWarning } from './MachineServerKeeperNotes'
import {
  ownSealServerReuseConfirmation,
  sealServerRemovalConfirmation
} from './seal-server-confirmations'
import {
  serverInstallIsRunning,
  serverInstallWaitsForHostText,
  serverManagerText
} from './seal-server-install-copy'
import { declineSealServerInstall, sealServerRequest } from './seal-server-install-requests'
import { useSealServerInstall, type SealServerInstallOptions } from './use-seal-server-install'

// Why untranslated: a literal shell command.
const OWN_SERVER_SERVICE_COMMAND = 'seal serve service install'

type Busy = 'install' | 'decline' | 'reuse' | 'remove'

/** Whether Seal's server is on the machine, how it is kept running, and what can be done about it. */
export function MachineServerStatus({
  view,
  connecting,
  onChanged
}: {
  view: MachineView
  connecting: boolean
  onChanged: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const confirm = useConfirmationDialog()
  const confirmAndInstall = useSealServerInstall()
  const mountedRef = useMountedRef()
  const [busy, setBusy] = useState<Busy | null>(null)
  const action = view.serverInstallAction
  const install = view.serverInstall
  const installed = view.connection === 'server' && install?.state === 'installed'
  // A server the user runs has no install record; the machine reports how it is kept running.
  const ownService =
    view.connection === 'server' && !installed && action === 'none' ? view.serverKeeper : undefined
  const keeper = installed ? install.manager : ownService
  const serviceRemains = view.serverServiceRemains === true
  const removable = installed || serviceRemains
  const title = t('seal.machineServer.server.title', 'Seal server')

  // Each request shows its own error toast; this only ends the busy state and refreshes the page.
  const run = (kind: Busy, request: () => Promise<unknown>): void => {
    setBusy(kind)
    void request().finally(() => {
      if (mountedRef.current) {
        setBusy(null)
      }
      onChanged()
    })
  }
  const installServer = (options?: SealServerInstallOptions): void =>
    run('install', () => confirmAndInstall(view, options))
  const runConfirmed = (
    kind: Busy,
    confirmation: ConfirmationDialogOptions,
    request: (api: MachinesApi) => Promise<MachineView>
  ): void =>
    void confirm(confirmation).then((confirmed) => {
      if (confirmed) {
        run(kind, () => sealServerRequest(request))
      }
    })

  const installRuns = serverInstallIsRunning(view, connecting)
  const band = (children: React.ReactNode): React.JSX.Element => (
    <section
      aria-label={title}
      data-machine-server={installRuns ? 'installing' : action}
      data-machine-server-keeper={keeper}
      data-machine-server-waits-for-host={
        installRuns && view.serverInstallWaitsForHost ? 'true' : undefined
      }
      className={cn('shrink-0 border-b border-border py-3', PAGE_GUTTER_X)}
    >
      {children}
    </section>
  )

  if (installRuns) {
    return band(
      <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <LoadingSpinner className="size-3.5 shrink-0" />
        {view.serverInstallWaitsForHost
          ? serverInstallWaitsForHostText(t)
          : t('seal.machineServer.server.installing', 'Installing Seal server…')}
      </p>
    )
  }
  if (action === 'retry') {
    return band(
      <MachineServerRetryNotice
        view={view}
        busy={busy !== null}
        onRetry={() => installServer()}
        onMoveAnyway={() => installServer({ moveAnyway: true })}
      />
    )
  }
  if (action === 'offer') {
    return band(
      <MachineServerOfferNotice
        busy={busy !== null}
        onInstall={() => installServer()}
        onDecline={() => run('decline', () => declineSealServerInstall(view.id))}
      />
    )
  }
  if (action === 'reuse') {
    return band(
      <MachineServerReuseNotice
        serviceName={view.serverOwnServe?.name}
        busy={busy === 'reuse'}
        onReuse={() =>
          runConfirmed('reuse', ownSealServerReuseConfirmation(t, view.name), (api) =>
            api.reuseOwnServer({ machineId: view.id })
          )
        }
      />
    )
  }
  if (
    !installed &&
    !ownService &&
    !view.serverLaunchdNeedsLogin &&
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
                {t('seal.machineServer.server.version', 'Version {{version}}', {
                  version: install.version
                })}
              </span>
            ) : null}
          </p>
        ) : ownService ? (
          <p>{serverManagerText(t, ownService)}</p>
        ) : serviceRemains ? (
          <MachineServerWarning kind="service-remains">
            {t(
              'seal.machineServer.server.serviceRemains',
              'Seal server was stopped, but its service is still registered on this machine. Remove it again to finish.'
            )}
          </MachineServerWarning>
        ) : action === 'install' ? (
          <p className="text-muted-foreground">
            {t('seal.machineServer.server.notInstalled', 'Not installed on this machine')}
          </p>
        ) : action === 'keep-running' ? (
          <p>{t('seal.machineServer.server.notService', 'Not kept running as a service')}</p>
        ) : null}
        <MachineServerKeeperNotes view={view} keeper={keeper} />
        {action === 'keep-running' ? (
          <p className="text-muted-foreground">
            {t(
              'seal.machineServer.server.keepRunningHelp',
              'As a user service, Seal server keeps running after this computer disconnects.'
            )}
          </p>
        ) : null}
        {action === 'own-server' ? (
          <>
            <p className="text-muted-foreground">
              {t(
                'seal.machineServer.server.ownServer',
                'To keep this server running as a service, run this on the machine:'
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
            disabled={busy !== null}
            data-machine-server-action={action}
            onClick={() =>
              installServer(
                action === 'keep-running'
                  ? {
                      purpose: 'keep-running',
                      // launchd is never picked automatically, so the earlier choice is asked for again.
                      manager: view.serverLaunchdNeedsLogin ? 'launchd' : undefined
                    }
                  : undefined
              )
            }
          >
            {action === 'install'
              ? t('seal.machineServer.server.installAction', 'Install Seal server…')
              : t('seal.machineServer.server.keepRunningAction', 'Keep it running as a service…')}
          </Button>
        ) : null}
        {removable ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy !== null}
            data-machine-server-action="remove"
            onClick={() =>
              runConfirmed('remove', sealServerRemovalConfirmation(t, view.name), (api) =>
                api.removeServer({ machineId: view.id })
              )
            }
          >
            {busy === 'remove' ? <LoadingSpinner /> : null}
            {t('seal.machineServer.remove.action', 'Remove Seal server…')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
