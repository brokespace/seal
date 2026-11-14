import { Trash2 } from 'lucide-react'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import { uiDateTimeFormat } from '@/i18n/ui-intl-formatters'
import type { SealMcpClient, SealMcpMachine } from '../../../../../shared/seal-mcp/seal-mcp-types'
import {
  sealMcpApprovalPolicyLabel,
  sealMcpScopeLabel
} from '@/components/seal-mcp/seal-mcp-labels'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { SettingsRow } from '../form-controls/SettingsFormControls'

const CREATED_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }

function machinesText(
  client: SealMcpClient,
  machines: readonly SealMcpMachine[] | null,
  allMachines: string
): string {
  if (client.machines === null) {
    return allMachines
  }
  // A machine that is gone, or a list not read yet, shows by its id.
  return client.machines
    .map((id) => machines?.find((machine) => machine.id === id)?.label ?? id)
    .join(', ')
}

/** Every MCP client of one server, with what each may do and when it was last seen. */
export function McpClientRows({
  clients,
  machines,
  now,
  onRevoke,
  onRemove
}: {
  clients: readonly SealMcpClient[]
  machines: readonly SealMcpMachine[] | null
  /** When the list was read; "last used" is measured from it. */
  now: number
  onRevoke: (client: SealMcpClient) => void
  onRemove: (client: SealMcpClient) => void
}): React.JSX.Element | React.JSX.Element[] {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  if (clients.length === 0) {
    return (
      <p className="py-3 text-xs text-muted-foreground" data-settings-row="">
        {t(
          'seal.mcp.clients.empty',
          'No clients yet. Add one to get a token an MCP client can connect with.'
        )}
      </p>
    )
  }
  return clients.map((client) => {
    const revoked = client.revokedAt !== null
    const facts = [
      machinesText(client, machines, t('seal.mcp.clients.allMachines', 'All machines')),
      sealMcpApprovalPolicyLabel(client.approval, t),
      client.allowRelay
        ? t('seal.mcp.clients.relayAllowed', 'Relay allowed')
        : t('seal.mcp.clients.relayBlocked', 'No relay'),
      t('seal.mcp.clients.rate', '{{rate}} calls/min', { rate: client.callsPerMinute })
    ]
    const times = [
      t('seal.mcp.clients.created', 'Created {{date}}', {
        date: uiDateTimeFormat(CREATED_FORMAT, intlLocale).format(client.createdAt)
      }),
      client.lastUsedAt === null
        ? t('seal.mcp.clients.neverUsed', 'Never used')
        : t('seal.mcp.clients.lastUsed', 'Last used {{when}}', {
            when: formatUiRelativeTime(Math.min(0, client.lastUsedAt - now), intlLocale)
          })
    ]
    return (
      <SettingsRow
        key={client.id}
        alignTop
        label={
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className={revoked ? 'truncate text-muted-foreground line-through' : 'truncate'}>
              {client.name}
            </span>
            {revoked ? (
              <Badge variant="destructive">{t('seal.mcp.clients.revoked', 'Revoked')}</Badge>
            ) : null}
          </span>
        }
        description={
          <span className="flex flex-col gap-1.5">
            <span className="flex flex-wrap gap-1">
              {client.scopes.map((scope) => (
                <Badge key={scope} variant="secondary">
                  {sealMcpScopeLabel(scope, t)}
                </Badge>
              ))}
            </span>
            <span>{facts.join(' · ')}</span>
            <span>{times.join(' · ')}</span>
          </span>
        }
        control={
          <div className="flex items-center gap-1">
            {revoked ? null : (
              <Button variant="ghost" size="xs" onClick={() => onRevoke(client)}>
                {t('seal.mcp.clients.revoke', 'Revoke')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('seal.mcp.clients.remove', 'Remove {{name}}', { name: client.name })}
              onClick={() => onRemove(client)}
            >
              <Trash2 />
            </Button>
          </div>
        }
      />
    )
  })
}
