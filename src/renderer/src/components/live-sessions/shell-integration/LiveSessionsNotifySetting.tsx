import { useState } from 'react'
import type { GlobalSettings } from '../../../../../shared/settings/global-settings-types'
import { outsideSessionsMuted } from '../../../../../shared/live-sessions/live-session-settings'
import { SettingsSwitchRow } from '../../settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}

/**
 * Shown only to a profile that had the switch off: the way back to hearing about these sessions.
 * Once turned on it stays until Settings closes, so a second click never lands on another setting.
 */
export function LiveSessionsNotifySetting({
  settings,
  updateSettings
}: Props): React.JSX.Element | null {
  const t = useTranslate()
  const muted = outsideSessionsMuted(settings)
  const [offered, setOffered] = useState(muted)
  if (muted && !offered) {
    setOffered(true)
  }
  if (!offered) {
    return null
  }
  return (
    <SettingsSwitchRow
      label={t('auto.components.live-sessions.notify.label', 'Notify about sessions outside Seal')}
      description={t(
        'auto.components.live-sessions.notify.description',
        'You had “Notify about agent sessions” off. Turn this on and “Agent needs input” and “Agent task complete” in Notifications also cover Claude Code and Codex sessions outside Seal’s own panes. Once on, this switch goes away when you leave Settings.'
      )}
      checked={!muted}
      onChange={() => void updateSettings({ liveSessionsNotify: muted })}
    />
  )
}
