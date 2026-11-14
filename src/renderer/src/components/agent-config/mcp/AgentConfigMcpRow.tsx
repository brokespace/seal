import React from 'react'
import { EllipsisVertical, Loader2, PlugZap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  AgentConfigMcpActivation,
  AgentConfigMcpAuth,
  AgentConfigMcpServer,
  AgentConfigMcpTestResult
} from '../../../../../shared/agent-config/agent-config-types'
import { SettingsBadge } from '../../settings/form-controls/SettingsFormControls'
import { agentConfigScopeLabel } from '../model/agent-config-scope-labels'

export type AgentConfigMcpTestState = AgentConfigMcpTestResult | 'testing'

function authLabel(auth: AgentConfigMcpAuth, t: Translate): string {
  switch (auth) {
    case 'none':
      return t('auto.components.agentConfig.mcp.auth.none', 'no sign-in needed')
    case 'static-header':
      return t('auto.components.agentConfig.mcp.auth.header', 'token in a header')
    case 'env-token':
      return t('auto.components.agentConfig.mcp.auth.env', 'token from the environment')
    case 'oauth-signed-in':
      return t('auto.components.agentConfig.mcp.auth.oauth', 'signed in with OAuth')
    case 'needs-auth':
      return t('auto.components.agentConfig.mcp.auth.needed', 'needs sign-in')
    case 'unknown':
      return ''
  }
}

/** What the file alone says about credentials, before anything is tested. */
function storedAuth(server: AgentConfigMcpServer, t: Translate): string {
  if (server.maskedFields.some((item) => item.startsWith('headers.'))) {
    return t('auto.components.agentConfig.mcp.stored.header', 'Token stored in a header')
  }
  if (server.extraKeys.includes('bearer_token_env_var')) {
    return t(
      'auto.components.agentConfig.mcp.stored.envVar',
      'Token read from an environment variable'
    )
  }
  if (server.maskedFields.length > 0) {
    return t('auto.components.agentConfig.mcp.stored.secret', 'Secret stored in the file')
  }
  return server.transport === 'stdio'
    ? t('auto.components.agentConfig.mcp.stored.none', 'No stored credentials')
    : t(
        'auto.components.agentConfig.mcp.stored.remoteNone',
        'No stored credentials; the agent signs in itself if the server asks'
      )
}

function testLine(result: AgentConfigMcpTestResult, t: Translate): string {
  const auth = authLabel(result.auth, t)
  switch (result.status) {
    case 'connected':
      return [
        t('auto.components.agentConfig.mcp.test.connected', 'Connected'),
        [result.serverName, result.serverVersion].filter(Boolean).join(' '),
        auth,
        `${result.durationMs} ms`
      ]
        .filter(Boolean)
        .join(' · ')
    case 'needs-auth':
      return [t('auto.components.agentConfig.mcp.test.needsAuth', 'Needs sign-in'), result.detail]
        .filter(Boolean)
        .join(' · ')
    case 'unsupported':
      return result.detail
    case 'failed':
      return [t('auto.components.agentConfig.mcp.test.failed', 'Failed'), result.detail]
        .filter(Boolean)
        .join(' · ')
  }
}

export function AgentConfigMcpRow({
  server,
  test,
  onTest,
  onEdit,
  onCopy,
  onRemove,
  onActivation
}: {
  server: AgentConfigMcpServer
  test: AgentConfigMcpTestState | undefined
  onTest: () => void
  onEdit: () => void
  onCopy: () => void
  onRemove: () => void
  onActivation: (activation: AgentConfigMcpActivation) => void
}): React.JSX.Element {
  const t = useTranslate()
  const summary =
    server.transport === 'stdio' ? [server.command, ...server.args].join(' ') : server.url
  const tested = test && test !== 'testing' ? test : null
  return (
    <div
      data-settings-row=""
      className="flex items-start gap-2 py-2.5"
      data-agent-config-mcp={`${server.scope}:${server.name}`}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-xs font-medium">{server.name}</span>
          <SettingsBadge tone="muted">{server.transport}</SettingsBadge>
          {server.enabled ? null : (
            <SettingsBadge tone="muted">
              {t('auto.components.agentConfig.mcp.off', 'off')}
            </SettingsBadge>
          )}
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground" title={summary}>
          {summary}
        </p>
        {server.issue ? (
          <p className="text-xs text-destructive [overflow-wrap:anywhere]">{server.issue}</p>
        ) : null}
        {server.shadowedBy ? (
          <p className="text-xs text-muted-foreground">
            {t(
              'auto.components.agentConfig.mcp.shadowed',
              'Not used here: the {{scope}} server with the same name replaces it.',
              { scope: agentConfigScopeLabel(server.shadowedBy, t) }
            )}
          </p>
        ) : null}
        <p
          className={cn(
            'text-xs [overflow-wrap:anywhere]',
            tested && tested.status !== 'connected' ? 'text-destructive' : 'text-muted-foreground'
          )}
          data-agent-config-mcp-status={tested?.status ?? ''}
        >
          {tested ? testLine(tested, t) : storedAuth(server, t)}
        </p>
      </div>
      {server.activation ? (
        <Select
          value={server.activation}
          onValueChange={(value) => {
            if (value === 'approved' || value === 'disabled' || value === 'pending') {
              onActivation(value)
            }
          }}
        >
          <SelectTrigger
            className="w-36 shrink-0"
            aria-label={t('auto.components.agentConfig.mcp.activation', 'Use in this project')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="approved">
              {t('auto.components.agentConfig.mcp.approved', 'Approved')}
            </SelectItem>
            <SelectItem value="pending">
              {t('auto.components.agentConfig.mcp.pending', 'Ask me first')}
            </SelectItem>
            <SelectItem value="disabled">
              {t('auto.components.agentConfig.mcp.disabled', 'Disabled')}
            </SelectItem>
          </SelectContent>
        </Select>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-20 shrink-0"
        disabled={test === 'testing'}
        onClick={onTest}
      >
        {test === 'testing' ? <Loader2 className="animate-spin" /> : <PlugZap />}
        {t('auto.components.agentConfig.mcp.testAction', 'Test')}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="mt-1"
            aria-label={t('auto.components.agentConfig.rowActions', 'Actions for {{name}}', {
              name: server.name
            })}
          >
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>
            {t('auto.components.agentConfig.edit', 'Edit')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onCopy}>
            {t('auto.components.agentConfig.copyTo', 'Copy to…')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onRemove}>
            {t('auto.components.agentConfig.mcp.remove', 'Remove…')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
