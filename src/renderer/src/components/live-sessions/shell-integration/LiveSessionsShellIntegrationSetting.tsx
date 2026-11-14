import { useEffect, useState } from 'react'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import type { ShellIntegrationStatus } from '../../../../../shared/shell-integration/shell-integration-installer'
import { Button } from '../../ui/button'
import { SettingsRow, SettingsSwitchRow } from '../../settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'
import { isWindowsDesktopClient } from '@/lib/files/os-open/windows-path-access'
import { LOCAL_SHELL_HOST_ID, runShellIntegrationAction } from './shell-integration-actions'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}

export function LiveSessionsShellIntegrationSetting({
  settings,
  updateSettings
}: Props): React.JSX.Element | null {
  const t = useTranslate()
  const [status, setStatus] = useState<ShellIntegrationStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const windows = isWindowsDesktopClient()
  const enabled = settings.liveSessionsWrapAgents !== false

  useEffect(() => {
    if (windows) {
      return
    }
    let live = true
    window.api.liveSessions
      .shellIntegration({ hostId: LOCAL_SHELL_HOST_ID, action: 'status' })
      .then((next) => live && setStatus(next))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [windows])

  if (windows) {
    return null
  }
  const run = async (action: 'install' | 'uninstall') => {
    setBusy(true)
    const next = await runShellIntegrationAction(LOCAL_SHELL_HOST_ID, action)
    if (next) {
      setStatus(next)
    }
    setBusy(false)
  }
  const installed = status?.installed === true
  const description = !status
    ? t('auto.components.live-sessions.shell-integration.checking', 'Checking this computer…')
    : !installed
      ? t(
          'auto.components.live-sessions.shell-integration.notInstalled',
          'Not installed. Seal can still message sessions you start inside tmux or a Seal pane.'
        )
      : status.tmux
        ? t(
            'auto.components.live-sessions.shell-integration.installedIn',
            'Installed in {{files}}.',
            { files: status.rcFiles.join(', ') || '—' }
          )
        : t(
            'auto.components.live-sessions.shell-integration.needsTmux',
            'Installed, but tmux 3.0 or newer is missing, so claude and codex run unwrapped.'
          )

  return (
    <>
      <SettingsSwitchRow
        label={t(
          'auto.components.live-sessions.shell-integration.toggle',
          'Let Seal message agents started in your terminal'
        )}
        description={t(
          'auto.components.live-sessions.shell-integration.toggleDescription',
          'With shell integration installed, claude and codex from zsh or bash run in a private tmux server (tmux -L seal) that Seal can type into. Off runs them directly, here and on SSH hosts.'
        )}
        checked={enabled}
        onChange={() => updateSettings({ liveSessionsWrapAgents: !enabled })}
      />
      <SettingsRow
        label={t(
          'auto.components.live-sessions.shell-integration.localTitle',
          'Shell integration on this computer'
        )}
        description={description}
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !status}
            onClick={() => void run(installed ? 'uninstall' : 'install')}
          >
            {installed
              ? t('auto.components.live-sessions.shell-integration.remove', 'Remove')
              : t('auto.components.live-sessions.shell-integration.install', 'Install')}
          </Button>
        }
      />
    </>
  )
}
