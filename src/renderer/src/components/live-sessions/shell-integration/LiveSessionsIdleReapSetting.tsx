import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import {
  SettingsRow,
  SettingsSegmentedControl
} from '../../settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'

const DEFAULT_MINUTES = 120
const PRESETS = [30, 120, 480, 1440] as const

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}

export function LiveSessionsIdleReapSetting({
  settings,
  updateSettings
}: Props): React.JSX.Element {
  const t = useTranslate()
  const minutes = Math.max(0, settings.liveSessionsIdleReapMinutes ?? DEFAULT_MINUTES)
  const hours = (count: number) =>
    count < 60
      ? t('auto.components.live-sessions.idleReap.minutes', '{{count}} min', { count })
      : t('auto.components.live-sessions.idleReap.hours', '{{count}} h', { count: count / 60 })
  return (
    <SettingsRow
      label={t('auto.components.live-sessions.idleReap.label', 'End idle Seal sessions')}
      description={t(
        'auto.components.live-sessions.idleReap.description',
        'A claude or codex Seal keeps running in its own tmux server (tmux -L seal) ends once no terminal shows it and nothing has happened in it for this long. Sessions you run in your own terminal or tmux are never touched.'
      )}
      control={
        <SettingsSegmentedControl
          size="sm"
          value={minutes}
          onChange={(value) => void updateSettings({ liveSessionsIdleReapMinutes: value })}
          ariaLabel={t('auto.components.live-sessions.idleReap.label', 'End idle Seal sessions')}
          options={[
            ...PRESETS.map((value) => ({ value, label: hours(value) })),
            { value: 0, label: t('auto.components.live-sessions.idleReap.never', 'Never') }
          ]}
        />
      }
    />
  )
}
