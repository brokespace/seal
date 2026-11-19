import React from 'react'
import { LogIn, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type {
  AgentConnector,
  AgentConnectorKind,
  AgentConnectorStatus
} from '../../../../shared/agent-connectors/agent-connector-types'
import { IntegrationStatusPill, type IntegrationStatusTone } from '../integration-status-pill'
import { SettingsBadge } from '../settings/form-controls/SettingsFormControls'

const STATUS_TONE: Record<AgentConnectorStatus, IntegrationStatusTone> = {
  connected: 'connected',
  'needs-auth': 'attention',
  failed: 'attention',
  disabled: 'neutral',
  configured: 'neutral'
}

function statusLabel(status: AgentConnectorStatus, t: Translate): string {
  switch (status) {
    case 'connected':
      return t('auto.components.agentConnectors.status.connected', 'Connected')
    case 'needs-auth':
      return t('auto.components.agentConnectors.status.needsAuth', 'Needs sign-in')
    case 'failed':
      return t('auto.components.agentConnectors.status.failed', 'Failed')
    case 'disabled':
      return t('auto.components.agentConnectors.status.disabled', 'Off')
    case 'configured':
      return t('auto.components.agentConnectors.status.configured', 'Not checked')
  }
}

export function agentConnectorKindLabel(kind: AgentConnectorKind, t: Translate): string {
  switch (kind) {
    case 'claude-ai':
      return t('auto.components.agentConnectors.kind.claudeAi', 'claude.ai connector')
    case 'plugin':
      return t('auto.components.agentConnectors.kind.plugin', 'Plugin')
    case 'user':
      return t('auto.components.agentConnectors.kind.user', 'User')
    case 'project':
      return t('auto.components.agentConnectors.kind.project', 'Project')
  }
}

/** Only servers reached over HTTP use OAuth; claude.ai connectors sign in through the CLI too. */
export function agentConnectorCanSignIn(connector: AgentConnector): boolean {
  return (
    connector.status !== 'disabled' &&
    (connector.kind === 'claude-ai' ||
      connector.transport === 'http' ||
      connector.transport === 'sse')
  )
}

export function AgentConnectorRow({
  connector,
  onSignIn
}: {
  connector: AgentConnector
  onSignIn: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const needsAuth = connector.status === 'needs-auth'
  return (
    <div
      data-settings-row=""
      className="flex items-start gap-3 py-2.5"
      data-agent-connector={connector.name}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-xs font-medium">{connector.name}</span>
          <SettingsBadge tone="muted">{agentConnectorKindLabel(connector.kind, t)}</SettingsBadge>
        </div>
        {connector.target ? (
          <p className="truncate font-mono text-xs text-muted-foreground" title={connector.target}>
            {connector.target}
          </p>
        ) : null}
        {connector.detail ? (
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {connector.detail}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        <IntegrationStatusPill tone={STATUS_TONE[connector.status]}>
          {statusLabel(connector.status, t)}
        </IntegrationStatusPill>
        {agentConnectorCanSignIn(connector) ? (
          <Button
            type="button"
            variant={needsAuth ? 'outline' : 'ghost'}
            size="sm"
            className="w-24"
            onClick={onSignIn}
          >
            {needsAuth ? <LogIn /> : <RefreshCw />}
            {needsAuth
              ? t('auto.components.agentConnectors.signIn', 'Sign in')
              : t('auto.components.agentConnectors.reconnect', 'Reconnect')}
          </Button>
        ) : (
          <span className="w-24" aria-hidden />
        )}
      </div>
    </div>
  )
}
