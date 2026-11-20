import { useTranslate } from '@/i18n/use-translate'
import { SettingsSwitchRow } from '../form-controls/SettingsFormControls'
import type { SessionSummarySettingsModel } from './use-session-summary-settings'

/** The switch that keeps session recaps on or off on one host. */
export function SessionRecapSwitchRow({
  model,
  compact = false,
  onChanged
}: {
  model: SessionSummarySettingsModel
  /** Leaves out the long description, where the row sits in a narrow panel. */
  compact?: boolean
  /** The switch was flipped and the host answered. */
  onChanged?: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { status } = model
  const loaded = status !== null
  return (
    <SettingsSwitchRow
      label={t('seal.sessionRecap.setting.title', 'Session recaps')}
      description={
        compact
          ? undefined
          : !loaded || status.recapConfigured !== false
            ? t(
                'seal.sessionRecap.setting.description',
                'Keep a recap of each session: what it is for, where it stands, what you asked, and the questions and action items still on you. It also names sessions you have not named. Your messages, the agent’s replies, the paths of files it read or edited, the command lines it ran (credentials redacted), and what it asked of a subagent and the subagent’s final report are sent. What tools print and the contents of files are never sent.'
              )
            : t('seal.summaryModels.needsSetup', 'Starts once its provider is set up.')
      }
      checked={status?.recapEnabled ?? true}
      disabled={!loaded || model.saving}
      onChange={() =>
        void model.setRecapEnabled(!(status?.recapEnabled ?? true)).then(() => onChanged?.())
      }
    />
  )
}
