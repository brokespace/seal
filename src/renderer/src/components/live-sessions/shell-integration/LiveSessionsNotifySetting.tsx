import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { outsideSessionsMuted } from '../../../../../shared/live-sessions/live-session-settings'
import { SettingsSwitchRow } from '../../settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}

/** Shown only to a profile that had the switch off: the way back to hearing about these sessions. */
export function LiveSessionsNotifySetting({
  settings,
  updateSettings
}: Props): React.JSX.Element | null {
  const t = useTranslate()
  if (!outsideSessionsMuted(settings)) {
    return null
  }
  return (
    <SettingsSwitchRow
      label={t('auto.components.live-sessions.notify.label', 'Notify about sessions outside Seal')}
      description={t(
        'auto.components.live-sessions.notify.description',
        'Off, as you left “Notify about agent sessions”. Turn it on and “Agent needs input” and “Agent task complete” in Notifications also cover Claude Code and Codex sessions outside Seal’s own panes. This switch then goes away.'
      )}
      checked={false}
      onChange={() => void updateSettings({ liveSessionsNotify: true })}
    />
  )
}
