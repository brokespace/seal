import React from 'react'
import { McpCopyButton } from '@/components/settings/mcp/McpCopyButton'
import { useTranslate } from '@/i18n/use-translate'

/** A command to run on the machine, shown literally on one line with an icon-only copy button. */
export function MachineCopyableCommand({ command }: { command: string }): React.JSX.Element {
  const t = useTranslate()
  return (
    <span className="flex min-w-0 items-center gap-0.5">
      <code className="min-w-0 truncate rounded bg-muted px-1 py-0.5 font-mono text-foreground select-text">
        {command}
      </code>
      <McpCopyButton
        iconOnly
        text={command}
        label={t('seal.machineServer.server.copyCommand', 'Copy command')}
      />
    </span>
  )
}
