import React from 'react'
import { TriangleAlert } from 'lucide-react'
import { Trans } from 'react-i18next'
import { i18n } from '@/i18n/i18n'
import { useTranslate } from '@/i18n/use-translate'
import type { MachineView } from '../../../../../shared/machines/machine-view'
import { quotePosixShellUnlessPlain } from '../../../../../shared/shell/launch/shell-argument-quoting'
import { MachineCopyableCommand } from './MachineCopyableCommand'

// Why untranslated: a literal shell command. The account is the one the machine names itself.
const lingerCommand = (hostUser: string | undefined): string =>
  `sudo loginctl enable-linger ${hostUser ? quotePosixShellUnlessPlain(hostUser) : '"$USER"'}`

export function MachineServerWarning({
  children,
  kind
}: {
  children: React.ReactNode
  kind: string
}): React.JSX.Element {
  return (
    <p
      className="flex items-start gap-1.5 text-status-warning-text"
      data-machine-server-warning={kind}
    >
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/** What the server's keeper does not do on this machine, and the command that fixes it when one does. */
export function MachineServerKeeperNotes({
  view,
  keeper
}: {
  view: Pick<
    MachineView,
    'serverInstall' | 'serverStartsAtBoot' | 'serverHostUser' | 'serverLaunchdNeedsLogin'
  >
  /** How the server on the machine is kept running now, when it is known. */
  keeper: MachineView['serverKeeper']
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <>
      {/* Only a refusal: an unanswered question about lingering is not one. */}
      {keeper === 'systemd-user' && view.serverInstall?.linger === false ? (
        <>
          <MachineServerWarning kind="linger-off">
            {t(
              'seal.machineServer.server.lingerOff',
              'Seal server stops about 10 seconds after this computer disconnects, because lingering is off for your account on this machine. To keep it running, run this on the machine:'
            )}
          </MachineServerWarning>
          <MachineCopyableCommand command={lingerCommand(view.serverHostUser)} />
        </>
      ) : null}
      {keeper === 'pm2' && view.serverStartsAtBoot === false ? (
        <MachineServerWarning kind="pm2-no-boot">
          <Trans
            i18n={i18n}
            defaults={t(
              'seal.machineServer.server.pm2NoBoot',
              'PM2 is not set to start at boot on this machine. Run <code>pm2 startup</code> there to keep the server across reboots.'
            )}
            components={{
              code: <code className="rounded bg-muted px-1 py-0.5 font-mono whitespace-nowrap" />
            }}
          />
        </MachineServerWarning>
      ) : null}
      {keeper === 'launchd' ? (
        <p className="text-muted-foreground" data-machine-server-note="launchd-login">
          {t(
            'seal.machineServer.server.launchdLogin',
            'launchd starts Seal server when you log in at this Mac’s screen. After a reboot the server does not start until you log in, and it never runs on a Mac nobody logs in to.'
          )}
        </p>
      ) : null}
      {view.serverLaunchdNeedsLogin ? (
        <MachineServerWarning kind="launchd-needs-login">
          {t(
            'seal.machineServer.server.launchdNeedsLogin',
            'launchd could not take the service because no one is logged in at this Mac’s screen, so Seal server starts when Seal connects and stops when idle. After you log in at the Mac, choose “Keep it running as a service” again.'
          )}
        </MachineServerWarning>
      ) : null}
    </>
  )
}
