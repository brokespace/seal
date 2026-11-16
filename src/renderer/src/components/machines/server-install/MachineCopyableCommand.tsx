import React from 'react'
import { McpCopyButton } from '@/components/settings/mcp/McpCopyButton'
import { useTranslate } from '@/i18n/use-translate'

/** A command to run on the machine, shown literally with a copy button. */
export function MachineCopyableCommand({ command }: { command: string }): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 truncate rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-foreground select-text">
        {command}
      </code>
      <McpCopyButton text={command} label={t('w7.server.copyCommand', 'Copy command')} />
    </div>
  )
}
