import React from 'react'
import { AlertTriangle, EllipsisVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import type { AgentConfigDocRef } from '../../../../../shared/agent-config/agent-config-types'
import { AgentConfigScopeBadge } from '../AgentConfigScopeBadge'

export type AgentConfigDocumentRowActions = {
  open: (doc: AgentConfigDocRef) => void
  duplicate: (doc: AgentConfigDocRef) => void
  rename: (doc: AgentConfigDocRef) => void
  copy: (doc: AgentConfigDocRef) => void
  remove: (doc: AgentConfigDocRef) => void
}

export function AgentConfigDocumentRow({
  doc,
  showScope,
  actions
}: {
  doc: AgentConfigDocRef
  /** Only where a list mixes scopes; elsewhere the badge would repeat the page. */
  showScope: boolean
  actions: AgentConfigDocumentRowActions
}): React.JSX.Element {
  const t = useTranslate()
  const title = doc.kind === 'instructions' ? (doc.relativePath ?? doc.name) : doc.name
  const errors = doc.issues.filter((issue) => issue.severity === 'error').length
  return (
    <div
      data-settings-row=""
      className="flex items-center gap-2 py-2"
      data-agent-config-doc={title}
    >
      <button
        type="button"
        className="-mx-2 flex min-w-0 flex-1 flex-col rounded-md px-2 py-1 text-left hover:bg-accent"
        onClick={() => actions.open(doc)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-xs font-medium">{title}</span>
          {showScope ? <AgentConfigScopeBadge scope={doc.scope} /> : null}
        </span>
        {doc.description ? (
          <span className="truncate text-xs text-muted-foreground">{doc.description}</span>
        ) : null}
        {doc.issues.length > 0 ? (
          <span
            className={
              errors > 0
                ? 'flex items-center gap-1 text-xs text-destructive'
                : 'flex items-center gap-1 text-xs text-muted-foreground'
            }
          >
            <AlertTriangle className="size-3 shrink-0" />
            <span className="truncate">{doc.issues[0]?.message}</span>
          </span>
        ) : null}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('auto.components.agentConfig.rowActions', 'Actions for {{name}}', {
              name: title
            })}
          >
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => actions.open(doc)}>
            {t('auto.components.agentConfig.edit', 'Edit')}
          </DropdownMenuItem>
          {doc.kind === 'instructions' ? null : (
            <>
              <DropdownMenuItem onSelect={() => actions.duplicate(doc)}>
                {t('auto.components.agentConfig.duplicate', 'Duplicate…')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.rename(doc)}>
                {t('auto.components.agentConfig.rename', 'Rename…')}
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onSelect={() => actions.copy(doc)}>
            {t('auto.components.agentConfig.copyTo', 'Copy to…')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => actions.remove(doc)}>
            {t('auto.components.agentConfig.delete', 'Delete…')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
