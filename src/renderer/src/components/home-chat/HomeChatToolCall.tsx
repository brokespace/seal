import { useMemo, useState } from 'react'
import { Ban, Check, ChevronRight, Loader2, Server, ShieldAlert, X } from 'lucide-react'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '../ui/button'
import { SecuritySurface } from '../ui/security-surface'
import type { HomeChatEntry } from '../../../../shared/home-chat/home-chat-types'
import type { NativeChatToolResultBlock } from '../../../../shared/native-chat/native-chat-types'
import { NativeChatToolOutput } from '../native-chat/tools/lines/NativeChatToolOutput'
import { formatHomeChatDuration } from './home-chat-format'
import {
  HOME_CHAT_FALLBACK_TOOL_ICON,
  HOME_CHAT_TOOL_ICONS,
  homeChatToolSummary
} from './home-chat-tool-presentation'

type ToolEntry = Extract<HomeChatEntry, { kind: 'tool' }>

function StatusIcon({ status }: { status: ToolEntry['status'] }): React.JSX.Element {
  switch (status) {
    case 'running':
      return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
    case 'ok':
      return <Check className="size-3.5 text-muted-foreground" />
    case 'error':
      return <X className="size-3.5 text-destructive" />
    case 'denied':
      return <Ban className="size-3.5 text-muted-foreground" />
    case 'awaiting-approval':
      return <ShieldAlert className="size-3.5 text-foreground" />
  }
}

export function HomeChatToolCall({
  entry,
  onRespond
}: {
  entry: ToolEntry
  onRespond: (approved: boolean) => void
}): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const Icon = HOME_CHAT_TOOL_ICONS[entry.tool] ?? HOME_CHAT_FALLBACK_TOOL_ICON
  const label = entry.tool.replace(/^mcp__\w+__/, '').replaceAll('_', ' ')
  const summary = homeChatToolSummary(entry.tool, entry.input)
  const hasInput = Object.keys(entry.input).length > 0
  const expandable = Boolean(entry.output) || hasInput
  const failed = entry.status === 'error'
  // The session transcript's output box: the same clipping, colours and "show full output".
  const output = useMemo<NativeChatToolResultBlock | null>(
    () => (entry.output ? { type: 'tool-result', output: entry.output, isError: failed } : null),
    [entry.output, failed]
  )

  return (
    <div
      className="rounded-lg border border-border bg-background text-xs"
      data-tool-status={entry.status}
      data-tool-name={entry.tool}
    >
      <button
        type="button"
        className={cn(
          'flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left',
          expandable && 'cursor-pointer hover:bg-accent'
        )}
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium capitalize text-foreground">{label}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground" title={summary}>
          {summary}
        </span>
        {entry.machine && (
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
            <Server className="size-3" />
            <span className="max-w-32 truncate">{entry.machine}</span>
          </span>
        )}
        {entry.durationMs !== undefined && (
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {formatHomeChatDuration(entry.durationMs)}
          </span>
        )}
        <StatusIcon status={entry.status} />
        {expandable && (
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90'
            )}
          />
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t border-border px-2.5 py-2">
          {hasInput && (
            <pre
              data-native-chat-code-content
              className="scrollbar-sleek max-h-48 overflow-auto rounded-lg border border-chat-code-border bg-chat-code-surface p-2 font-mono text-chat-code break-all whitespace-pre-wrap text-chat-foreground-faint"
            >
              {JSON.stringify(entry.input, null, 2)}
            </pre>
          )}
          {output && <NativeChatToolOutput body={output} />}
        </div>
      )}

      {entry.status === 'awaiting-approval' && (
        <SecuritySurface>
          <div className="flex items-center gap-3 border-t border-border bg-muted/40 px-2.5 py-2">
            <p className="min-w-0 flex-1 text-xs text-foreground">
              {entry.approvalReason ??
                t('homeChat.approval.default', 'This action needs your approval.')}
            </p>
            <Button size="xs" variant="ghost" onClick={() => onRespond(false)}>
              {t('homeChat.approval.decline', 'Decline')}
            </Button>
            <Button size="xs" onClick={() => onRespond(true)}>
              {t('homeChat.approval.approve', 'Approve')}
            </Button>
          </div>
        </SecuritySurface>
      )}
    </div>
  )
}
