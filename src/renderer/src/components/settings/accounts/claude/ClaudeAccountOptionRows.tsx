import type React from 'react'
import { useAppStore } from '@/store'
import type { GlobalSettings } from '../../../../../../shared/global-settings-types'
import { ClaudeOAuthUsageSetting } from './claude-oauth-usage-setting'
import { ClaudeRunningSessionSwitchSetting } from './claude-running-session-switch-setting'

export function ClaudeAccountOptionRows({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void> | void
}): React.JSX.Element {
  const recordFeatureInteraction = useAppStore((s) => s.recordFeatureInteraction)
  return (
    <>
      <ClaudeOAuthUsageSetting
        settings={settings}
        updateSettings={updateSettings}
        recordFeatureInteraction={recordFeatureInteraction}
      />
      <ClaudeRunningSessionSwitchSetting settings={settings} updateSettings={updateSettings} />
    </>
  )
}
