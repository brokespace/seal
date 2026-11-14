import { useId, useState } from 'react'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import { uiDateTimeFormat } from '@/i18n/ui-intl-formatters'
import { cn } from '@/lib/class-names'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type {
  SealMcpAuditEntry,
  SealMcpAuditOutcome,
  SealMcpClient
} from '../../../../../shared/seal-mcp/seal-mcp-types'
import { sealMcpOutcomeLabel, sealMcpTransportLabel } from '@/components/seal-mcp/seal-mcp-labels'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { useSealMcpAudit, type SealMcpAuditState } from './use-seal-mcp-audit'

const ALL_CLIENTS = '__all__'
const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit'
}

/** Allowed calls read quietly; what Seal refused is outlined, what failed or was not let in is red. */
function outcomeBadgeVariant(
  outcome: SealMcpAuditOutcome
): 'secondary' | 'outline' | 'destructive' {
  switch (outcome) {
    case 'ok':
      return 'secondary'
    case 'error':
    case 'unauthorized':
      return 'destructive'
    case 'scope-denied':
    case 'machine-denied':
    case 'approval-denied':
    case 'rate-limited':
      return 'outline'
  }
}

function McpAuditEntryRow({ entry }: { entry: SealMcpAuditEntry }): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const facts = [
    sealMcpTransportLabel(entry.transport, t),
    ...(entry.machine ? [entry.machine] : []),
    ...(entry.remote ? [entry.remote] : [])
  ]
  return (
    <li className="grid min-w-0 gap-1 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 truncate font-mono text-xs text-foreground">
          {entry.tool ?? entry.method}
        </span>
        <Badge variant={outcomeBadgeVariant(entry.outcome)}>
          {sealMcpOutcomeLabel(entry.outcome, t)}
        </Badge>
        {entry.approved === true ? (
          <Badge variant="outline">{t('seal.mcp.audit.approved', 'Approved in the app')}</Badge>
        ) : null}
        <time
          className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums"
          dateTime={new Date(entry.at).toISOString()}
        >
          {uiDateTimeFormat(TIME_FORMAT, intlLocale).format(entry.at)}
        </time>
      </div>
      <p className="min-w-0 text-xs text-muted-foreground">
        <span className={cn(entry.clientName ? 'text-foreground' : 'text-destructive')}>
          {entry.clientName ?? t('seal.mcp.audit.noToken', 'No valid token')}
        </span>
        {facts.map((fact) => ` · ${fact}`).join('')}
      </p>
      {entry.summary ? (
        <p className="min-w-0 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground select-text">
          {entry.summary}
        </p>
      ) : null}
      {entry.detail ? (
        <p className="min-w-0 text-xs break-words whitespace-pre-wrap text-foreground select-text">
          {entry.detail}
        </p>
      ) : null}
    </li>
  )
}

type McpAuditLogViewProps = {
  clients: readonly SealMcpClient[]
  /** Null shows every client's calls, and the ones that carried no valid token. */
  clientId: string | null
  onClientIdChange: (clientId: string | null) => void
  state: SealMcpAuditState
  onLoadOlder: () => void
}

/** The audit list and its client filter, given the entries to show. */
export function McpAuditLogView({
  clients,
  clientId,
  onClientIdChange,
  state,
  onLoadOlder
}: McpAuditLogViewProps): React.JSX.Element {
  const t = useTranslate()
  const filterLabelId = useId()
  return (
    <div className="grid min-w-0 gap-1 py-3" data-settings-row="">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span id={filterLabelId} className="text-xs text-muted-foreground">
          {t('seal.mcp.audit.filter', 'Show calls from')}
        </span>
        <Select
          value={clientId ?? ALL_CLIENTS}
          onValueChange={(next) => onClientIdChange(next === ALL_CLIENTS ? null : next)}
        >
          <SelectTrigger size="sm" className="max-w-60 min-w-40" aria-labelledby={filterLabelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CLIENTS}>
              {t('seal.mcp.audit.allClients', 'Every client')}
            </SelectItem>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id}>
                {client.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {state.phase === 'loading' ? (
        <p className="py-2 text-xs text-muted-foreground">
          {t('seal.mcp.audit.loading', 'Reading the audit log…')}
        </p>
      ) : state.phase === 'error' ? (
        <p className="py-2 text-xs text-destructive">
          {t('seal.mcp.audit.loadFailed', 'Could not read the audit log: {{error}}', {
            error: state.error ?? ''
          })}
        </p>
      ) : state.entries.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">
          {clientId
            ? t('seal.mcp.audit.emptyClient', 'No calls from this client yet.')
            : t('seal.mcp.audit.empty', 'No MCP calls yet.')}
        </p>
      ) : (
        <>
          <ul className="min-w-0 divide-y divide-border/60">
            {state.entries.map((entry) => (
              <McpAuditEntryRow key={entry.id} entry={entry} />
            ))}
          </ul>
          {state.error ? (
            <p className="text-xs text-destructive">
              {t('seal.mcp.audit.olderFailed', 'Could not load older calls: {{error}}', {
                error: state.error
              })}
            </p>
          ) : null}
          {state.hasOlder ? (
            <div>
              <Button
                variant="outline"
                size="xs"
                disabled={state.loadingOlder}
                onClick={onLoadOlder}
              >
                {state.loadingOlder
                  ? t('seal.mcp.audit.loadingOlder', 'Loading…')
                  : t('seal.mcp.audit.loadOlder', 'Load older')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function McpAuditLogFeed({
  target,
  clients,
  clientId,
  onClientIdChange
}: {
  target: RuntimeClientTarget
  clients: readonly SealMcpClient[]
  clientId: string | null
  onClientIdChange: (clientId: string | null) => void
}): React.JSX.Element {
  const { loadOlder, ...state } = useSealMcpAudit(target, clientId)
  return (
    <McpAuditLogView
      clients={clients}
      clientId={clientId}
      onClientIdChange={onClientIdChange}
      state={state}
      onLoadOlder={loadOlder}
    />
  )
}

/** One server's MCP audit log, live. The owner keys it by server. */
export function McpAuditLog({
  target,
  clients
}: {
  target: RuntimeClientTarget
  clients: readonly SealMcpClient[]
}): React.JSX.Element {
  const [chosen, setClientId] = useState<string | null>(null)
  // A filter on a client that was removed falls back to every client.
  const clientId = chosen && clients.some((client) => client.id === chosen) ? chosen : null
  return (
    <McpAuditLogFeed
      // Why: a filter change starts a new list rather than mixing two.
      key={clientId ?? ALL_CLIENTS}
      target={target}
      clients={clients}
      clientId={clientId}
      onClientIdChange={setClientId}
    />
  )
}
