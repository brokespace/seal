import { useId, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { SealMcpConnection } from '../../../../../shared/seal-mcp/seal-mcp-client-config'
import type { SealMcpStatus } from '../../../../../shared/seal-mcp/seal-mcp-types'
import { Label } from '../../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { McpSetupSnippets } from './McpSetupSnippets'

const STDIO = 'stdio'
const RELAY = 'relay'
const HTTP_PREFIX = 'http:'

/** Picks how a client reaches this server, then shows the setup text for that transport. */
export function McpConnectClient({
  status,
  environment,
  token,
  relayAllowed = true
}: {
  status: SealMcpStatus
  /** The paired server `seal mcp` should drive; null for this computer. */
  environment: string | null
  /** A new client's token while its dialog is open; without it the snippets show a placeholder. */
  token?: string
  /** False for a client that may not use the relay, so its setup never offers that URL. */
  relayAllowed?: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const relayUrl = relayAllowed ? status.relayUrl : null
  const labelId = useId()
  const [choice, setChoice] = useState(STDIO)
  const httpUrl = choice.startsWith(HTTP_PREFIX) ? choice.slice(HTTP_PREFIX.length) : null
  // A URL that went away (listener or relay identity changed) falls back to stdio.
  const connection: SealMcpConnection =
    httpUrl && status.httpUrls.includes(httpUrl)
      ? { kind: 'http', url: httpUrl }
      : choice === RELAY && relayUrl
        ? { kind: 'http', url: relayUrl }
        : { kind: 'stdio', environment }
  const value =
    connection.kind === 'stdio' ? STDIO : choice === RELAY ? RELAY : `${HTTP_PREFIX}${httpUrl}`
  const note =
    value === STDIO
      ? environment
        ? t(
            'seal.mcp.connect.stdioRemoteNote',
            'The client runs "seal mcp" on this computer, which carries its calls to the selected server.'
          )
        : null
      : value === RELAY
        ? status.settings.relayEnabled
          ? t(
              'seal.mcp.connect.relayNote',
              'Only a client created with "Allow through relay" can connect at this URL.'
            )
          : t(
              'seal.mcp.connect.relayOffNote',
              'The relay endpoint is off. Turn it on under Endpoints before connecting.'
            )
        : status.settings.httpEnabled
          ? null
          : t(
              'seal.mcp.connect.httpOffNote',
              'The HTTP endpoint is off. Turn it on under Endpoints before connecting.'
            )

  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid gap-1.5">
        <Label id={labelId}>{t('seal.mcp.connect.transport', 'Transport')}</Label>
        <Select value={value} onValueChange={setChoice}>
          <SelectTrigger size="sm" className="w-full" aria-labelledby={labelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STDIO}>
              {t('seal.mcp.connect.stdio', 'stdio on this computer')}
            </SelectItem>
            {status.httpUrls.map((url) => (
              <SelectItem key={url} value={`${HTTP_PREFIX}${url}`}>
                {t('seal.mcp.connect.http', 'HTTP: {{url}}', { url })}
              </SelectItem>
            ))}
            {relayUrl ? (
              <SelectItem value={RELAY}>
                {t('seal.mcp.connect.relay', 'Relay: {{url}}', { url: relayUrl })}
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
      <McpSetupSnippets connection={connection} token={token} />
    </div>
  )
}
