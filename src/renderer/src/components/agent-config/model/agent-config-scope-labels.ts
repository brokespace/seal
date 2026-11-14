import type { AgentConfigScope } from '../../../../../shared/agent-config/agent-config-types'
import type { Translate } from '@/i18n/use-translate'

/** One name per scope everywhere: lists, badges, pickers and the merged view. */
export function agentConfigScopeLabel(scope: AgentConfigScope, t: Translate): string {
  switch (scope) {
    case 'user':
      return t('auto.components.agentConfig.scope.user', 'Account')
    case 'project':
      return t('auto.components.agentConfig.scope.project', 'Project')
    case 'local':
      return t('auto.components.agentConfig.scope.local', 'Only me')
  }
}

export function agentConfigScopeHint(scope: AgentConfigScope, t: Translate): string {
  switch (scope) {
    case 'user':
      return t(
        'auto.components.agentConfig.scope.userHint',
        'Applies to every project on this machine.'
      )
    case 'project':
      return t(
        'auto.components.agentConfig.scope.projectHint',
        'Checked in with the project, shared with everyone who works on it.'
      )
    case 'local':
      return t(
        'auto.components.agentConfig.scope.localHint',
        'Your own overrides for this project, not checked in.'
      )
  }
}
