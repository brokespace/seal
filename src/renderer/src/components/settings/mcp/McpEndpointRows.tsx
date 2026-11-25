import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { SealMcpSettings, SealMcpStatus } from '../../../../../shared/seal-mcp/seal-mcp-types'
import { SettingsSwitchRow } from '../form-controls/SettingsFormControls'
import { McpCopyButton } from './McpCopyButton'

function EndpointUrl({ url, copyLabel }: { url: string; copyLabel: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-foreground select-text">
        {url}
      </code>
      <McpCopyButton text={url} label={copyLabel} />
    </div>
  )
}

function EndpointNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="text-xs text-muted-foreground">{children}</p>
}

/** Where MCP clients can reach this server, and the switches for the two network endpoints. */
export function McpEndpointRows({
  status,
  busy,
  onUpdate
}: {
  status: SealMcpStatus
  /** A settings write is in flight; the switches wait for it. */
  busy: boolean
  onUpdate: (patch: Partial<SealMcpSettings>) => void
}): React.JSX.Element {
  const t = useTranslate()
  const { httpEnabled, relayEnabled } = status.settings
  return (
    <>
      <div data-settings-row="">
        <SettingsSwitchRow
          label={t('seal.mcp.endpoints.http.label', "HTTP on this server's port")}
          description={t(
            'seal.mcp.endpoints.http.description',
            'Serves /mcp on the port the Seal server already listens on. It is plain HTTP without TLS, meant for a LAN or a tailnet, not the open internet.'
          )}
          checked={httpEnabled}
          disabled={busy}
          onChange={() => onUpdate({ httpEnabled: !httpEnabled })}
        />
        {httpEnabled ? (
          <div className="space-y-1.5 pb-3">
            {status.httpUrls.length === 0 ? (
              <EndpointNote>
                {t(
                  'seal.mcp.endpoints.http.noListener',
                  'This server has no network listener yet, so there is no HTTP URL to connect to.'
                )}
              </EndpointNote>
            ) : (
              status.httpUrls.map((url) => (
                <EndpointUrl
                  key={url}
                  url={url}
                  copyLabel={t('seal.mcp.endpoints.http.copy', 'Copy HTTP URL')}
                />
              ))
            )}
          </div>
        ) : null}
      </div>
      <div data-settings-row="">
        <SettingsSwitchRow
          label={t('seal.mcp.endpoints.relay.label', 'Seal relay')}
          description={t(
            'seal.mcp.endpoints.relay.description',
            'Gives this server a public HTTPS URL on the Seal relay. The relay terminates TLS, so it can read everything that passes through it, tokens included. Only a client created with "Allow through relay" can use it, and destructive calls over the relay always ask for approval.'
          )}
          checked={relayEnabled}
          disabled={busy}
          onChange={() => onUpdate({ relayEnabled: !relayEnabled })}
        />
        <div className="space-y-1.5 pb-3">
          {status.relayUrl ? (
            <>
              <EndpointUrl
                url={status.relayUrl}
                copyLabel={t('seal.mcp.endpoints.relay.copy', 'Copy relay URL')}
              />
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className={cn(
                    'size-1.5 rounded-full',
                    relayEnabled && status.relayConnected
                      ? 'bg-status-success'
                      : 'bg-muted-foreground/50'
                  )}
                />
                {!relayEnabled
                  ? t(
                      'seal.mcp.endpoints.relay.off',
                      'The relay endpoint is off, so calls to this URL are refused.'
                    )
                  : status.relayConnected
                    ? t('seal.mcp.endpoints.relay.connected', 'Connected to the relay')
                    : t('seal.mcp.endpoints.relay.notConnected', 'Not connected to the relay')}
              </p>
            </>
          ) : (
            <EndpointNote>
              {t(
                'seal.mcp.endpoints.relay.noIdentity',
                'Pair a device first so this server has a relay identity.'
              )}
            </EndpointNote>
          )}
        </div>
      </div>
      <p data-settings-row="" className="py-3 text-xs text-muted-foreground">
        {t(
          'seal.mcp.endpoints.stdio',
          'stdio is always available on this computer: an MCP client starts the "seal mcp" command and talks to it directly.'
        )}
      </p>
    </>
  )
}
