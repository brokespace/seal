import type React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { AgentConfigScope } from '../../../../shared/agent-config/agent-config-types'
import { SettingsBadge } from '../settings/form-controls/SettingsFormControls'
import { agentConfigScopeLabel } from './model/agent-config-scope-labels'

export function AgentConfigScopeBadge({ scope }: { scope: AgentConfigScope }): React.JSX.Element {
  const t = useTranslate()
  return (
    <SettingsBadge tone={scope === 'user' ? 'muted' : 'neutral'} className="shrink-0">
      {agentConfigScopeLabel(scope, t)}
    </SettingsBadge>
  )
}
