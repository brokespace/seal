import { useTranslate } from '@/i18n/use-translate'
import {
  sealMcpClientSnippets,
  type SealMcpConnection
} from '../../../../../shared/seal-mcp/seal-mcp-client-config'
import { McpCopyButton } from './McpCopyButton'

/** Copy-paste setup for each supported MCP client; `token` fills in the real one while it is on screen. */
export function McpSetupSnippets({
  connection,
  token
}: {
  connection: SealMcpConnection
  token?: string
}): React.JSX.Element {
  const t = useTranslate()
  const snippets = sealMcpClientSnippets(connection, token)
  return (
    <div className="grid min-w-0 gap-3">
      {snippets.map((snippet) => {
        const title =
          snippet.id === 'generic'
            ? t('seal.mcp.snippets.generic', 'Any other client')
            : snippet.title
        return (
          <div key={snippet.id} className="grid min-w-0 gap-1.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm font-medium">
                {title}
                <span className="text-xs font-normal text-muted-foreground">
                  {snippet.target === 'shell'
                    ? t('seal.mcp.snippets.shell', 'Run in a terminal')
                    : t('seal.mcp.snippets.file', 'Add to {{file}}', { file: snippet.target })}
                </span>
              </p>
              <McpCopyButton
                text={snippet.text}
                label={t('seal.mcp.snippets.copy', 'Copy {{client}} setup', { client: title })}
              />
            </div>
            <pre className="max-w-full overflow-x-auto rounded-md border border-border bg-muted/40 px-2.5 py-2 font-mono text-xs leading-relaxed text-foreground select-text scrollbar-sleek">
              {snippet.text}
            </pre>
          </div>
        )
      })}
    </div>
  )
}
