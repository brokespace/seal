import { Plus } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type {
  SealMcpApprovalRequest,
  SealMcpClient,
  SealMcpMachine,
  SealMcpSettings
} from '../../../../../shared/seal-mcp/seal-mcp-types'
import { SealMcpApprovalRequestView } from '@/components/seal-mcp/SealMcpApprovalRequestView'
import { sealMcpAnswerInFlight } from '@/components/seal-mcp/SealMcpApprovalPrompt'
import type { SealMcpApprovalAnswer } from '@/components/seal-mcp/use-seal-mcp-approvals'
import { Button } from '../../ui/button'
import { SecuritySurface } from '../../ui/security-surface'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { McpClientRows } from './McpClientRows'
import { McpConnectClient } from './McpConnectClient'
import { McpEndpointRows } from './McpEndpointRows'
import type { SealMcpLoad } from './use-seal-mcp'

export type McpSettingsActions = {
  retry: () => void
  updateSettings: (patch: Partial<SealMcpSettings>) => void
  addClient: () => void
  revokeClient: (client: SealMcpClient) => void
  removeClient: (client: SealMcpClient) => void
  respondApproval: (approvalId: string, approved: boolean) => void
}

type McpSettingsViewProps = {
  /** The paired server being managed, or null for the Seal server on this computer. */
  hostName: string | null
  /** What `seal mcp --environment` takes to reach that paired server; null for this computer. */
  environment: string | null
  load: SealMcpLoad
  machines: readonly SealMcpMachine[] | null
  approvals: readonly SealMcpApprovalRequest[]
  answering: SealMcpApprovalAnswer | null
  /** A settings write is in flight. */
  busy: boolean
  actions: McpSettingsActions
  /** The audit log, which reads its own pages. */
  audit: React.ReactNode
}

function Notice({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="py-3 text-xs text-muted-foreground" data-settings-row="">
      {children}
    </div>
  )
}

/** Settings → MCP for one Seal server, given what that server reported. */
export function McpSettingsView({
  hostName,
  environment,
  load,
  machines,
  approvals,
  answering,
  busy,
  actions,
  audit
}: McpSettingsViewProps): React.JSX.Element {
  const t = useTranslate()
  const managed = (
    <p className="px-1 text-xs text-muted-foreground" data-slot="seal-mcp-managed-server">
      {hostName
        ? t('seal.mcp.managed.remote', 'Managing the Seal server on {{name}}.', { name: hostName })
        : t('seal.mcp.managed.local', 'Managing the Seal server on this computer.')}
    </p>
  )

  if (load.phase !== 'ready') {
    return (
      <div className="space-y-3" data-slot="seal-mcp-settings">
        {managed}
        <SettingsGroup>
          {load.phase === 'loading' ? (
            <Notice>{t('seal.mcp.loading', 'Reading MCP settings…')}</Notice>
          ) : load.phase === 'unsupported' ? (
            <Notice>
              {t(
                'seal.mcp.unsupported',
                'This Seal server does not have the MCP server yet. Update Seal on that machine to manage it here.'
              )}
            </Notice>
          ) : (
            <Notice>
              <p className="text-destructive">
                {t('seal.mcp.loadFailed', 'Could not read MCP settings: {{error}}', {
                  error: load.message
                })}
              </p>
              <Button variant="outline" size="xs" className="mt-2" onClick={actions.retry}>
                {t('seal.mcp.retry', 'Try again')}
              </Button>
            </Notice>
          )}
        </SettingsGroup>
      </div>
    )
  }

  const { status, clients } = load.snapshot
  return (
    <div className="space-y-8" data-slot="seal-mcp-settings">
      {managed}

      {approvals.length > 0 ? (
        <SettingsGroup
          title={t('seal.mcp.pending.title', 'Waiting for approval')}
          description={t(
            'seal.mcp.pending.description',
            'Each call is declined if nobody answers before its time runs out.'
          )}
        >
          {approvals.map((request) => (
            <SecuritySurface key={request.id}>
              <div className="py-3" data-settings-row="">
                <SealMcpApprovalRequestView
                  request={request}
                  answering={sealMcpAnswerInFlight(answering, request)}
                  onRespond={(approved) => actions.respondApproval(request.id, approved)}
                />
              </div>
            </SecuritySurface>
          ))}
        </SettingsGroup>
      ) : null}

      <SettingsGroup
        title={t('seal.mcp.endpoints.title', 'Endpoints')}
        description={t(
          'seal.mcp.endpoints.description',
          'How MCP clients reach this server. Every call needs a client token, whichever way it arrives.'
        )}
      >
        <McpEndpointRows status={status} busy={busy} onUpdate={actions.updateSettings} />
      </SettingsGroup>

      <SettingsGroup
        title={t('seal.mcp.clients.title', 'Clients')}
        description={t(
          'seal.mcp.clients.description',
          'One token per client. Revoking stops the token at once and keeps the entry; removing deletes it.'
        )}
        action={
          <Button variant="outline" size="sm" onClick={actions.addClient}>
            <Plus />
            {t('seal.mcp.clients.add', 'Add client')}
          </Button>
        }
      >
        <McpClientRows
          clients={clients}
          machines={machines}
          now={load.readAt}
          onRevoke={actions.revokeClient}
          onRemove={actions.removeClient}
        />
      </SettingsGroup>

      <SettingsGroup
        title={t('seal.mcp.connect.title', 'Connect a client')}
        description={t(
          'seal.mcp.connect.description',
          'Replace <token> with the token shown when you added the client. Seal cannot show it again.'
        )}
      >
        <div className="py-3" data-settings-row="">
          <McpConnectClient status={status} environment={environment} />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t('seal.mcp.audit.title', 'Audit log')}
        description={t(
          'seal.mcp.audit.description',
          'Every MCP request this server received, newest first, including the ones it refused.'
        )}
      >
        {audit}
      </SettingsGroup>
    </div>
  )
}
