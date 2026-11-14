import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { SettingsSwitchRow } from '../../settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}

export function LiveSessionsNotifySetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const on = settings.liveSessionsNotify !== false
  return (
    <SettingsSwitchRow
      label={t('auto.components.live-sessions.notify.label', 'Notify about agent sessions')}
      description={t(
        'auto.components.live-sessions.notify.description',
        'A desktop notification when a Claude Code or Codex session outside Seal’s own panes needs permission or an answer, fails, or finishes. Follows the notification settings: nothing shows while notifications are off.'
      )}
      checked={on}
      onChange={() => void updateSettings({ liveSessionsNotify: !on })}
    />
  )
}
