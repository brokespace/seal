import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { quotePosixShellUnlessPlain } from '../../../../../shared/shell/launch/shell-argument-quoting'
import { MachineCopyableCommand } from './MachineCopyableCommand'

// Why untranslated: a literal shell command. The account is the one the machine names itself.
export const lingerCommand = (hostUser: string | undefined): string =>
  `sudo loginctl enable-linger ${hostUser ? quotePosixShellUnlessPlain(hostUser) : '"$USER"'}`

/** The one command that keeps a systemd user server running after the last session on the machine ends. */
export function MachineServerLingerLine({
  hostUser
}: {
  hostUser: string | undefined
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <p
      className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground"
      data-machine-server-warning="linger-off"
    >
      <span className="shrink-0">
        {t('seal.machineServer.server.lingerRun', 'Run as service:')}
      </span>
      <MachineCopyableCommand command={lingerCommand(hostUser)} />
      <span className="shrink-0">{t('seal.machineServer.server.lingerSudo', 'needs sudo')}</span>
    </p>
  )
}
