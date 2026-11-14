import { TerminalSquare, Undo2 } from 'lucide-react'
import type { SshConnectionState } from '../../../../../shared/ssh-types'
import { DropdownMenuItem } from '../../ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { runShellIntegrationAction } from './shell-integration-actions'

/** SSH host setup: lets Seal message claude/codex sessions started in that host's shells. */
export function SshShellIntegrationMenuItems({
  targetId,
  state
}: {
  targetId: string
  state: SshConnectionState | undefined
}): React.JSX.Element | null {
  const t = useTranslate()
  if (state?.remotePlatform === 'win32') {
    return null
  }
  const disabled = state?.status !== 'connected'
  return (
    <>
      <DropdownMenuItem
        disabled={disabled}
        onSelect={() => void runShellIntegrationAction(targetId, 'install')}
      >
        <TerminalSquare />
        {t(
          'auto.components.live-sessions.shell-integration.sshInstall',
          'Install shell integration'
        )}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={disabled}
        onSelect={() => void runShellIntegrationAction(targetId, 'uninstall')}
      >
        <Undo2 />
        {t('auto.components.live-sessions.shell-integration.sshRemove', 'Remove shell integration')}
      </DropdownMenuItem>
    </>
  )
}
