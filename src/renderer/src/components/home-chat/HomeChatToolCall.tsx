import { useState } from 'react'
import {
  Activity,
  ArrowLeftRight,
  Ban,
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  Check,
  ChevronRight,
  Eraser,
  FilePen,
  FileText,
  Globe,
  ListChecks,
  Loader2,
  Megaphone,
  MessageSquare,
  Paperclip,
  Search,
  Server,
  ServerCog,
  ShieldAlert,
  Square,
  Terminal,
  Trash2,
  Users,
  Wrench,
  X,
  type LucideIcon
} from 'lucide-react'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '../ui/button'
import { SecuritySurface } from '../ui/security-surface'
import type { HomeChatEntry } from '../../../../shared/home-chat/home-chat-types'
import { formatHomeChatDuration } from './home-chat-format'

type ToolEntry = Extract<HomeChatEntry, { kind: 'tool' }>

const TOOL_ICONS: Record<string, LucideIcon> = {
  run_command: Terminal,
  read_file: FileText,
  write_file: FilePen,
  transfer_file: ArrowLeftRight,
  delete_path: Trash2,
  orca_cli: Bot,
  list_machines: Server,
  job_status: Activity,
  job_output: FileText,
  job_kill: Square,
  job_cleanup: Eraser,
  configure_machine: ServerCog,
  attach_file: Paperclip,
  report_progress: Megaphone,
  remember: Brain,
  forget: Eraser,
  load_skill: BookOpen,
  spawn_subagent: Users,
  check_subagent: ListChecks,
  message_subagent: MessageSquare,
  stop_subagent: Square,
  web_search: Search,
  web_fetch: Globe,
  routines: CalendarClock
}

/** One line that says what the call does, in the words of the tool's own arguments. */
function toolSummary(entry: ToolEntry): string {
  const input = entry.input
  const str = (key: string): string => String(input[key] ?? '')
  switch (entry.tool) {
    case 'run_command':
      return `${input.background === true ? '& ' : '$ '}${str('command')}`
    case 'read_file':
    case 'write_file':
    case 'delete_path':
    case 'attach_file':
      return str('path')
    case 'job_status':
    case 'job_output':
    case 'job_kill':
    case 'job_cleanup':
      return str('job_id')
    case 'configure_machine':
      return str('machine')
    case 'remember':
      return `${str('kind') || 'fact'}: ${str('text')}`
    case 'forget':
      return str('query')
    case 'load_skill':
      return str('name')
    case 'spawn_subagent':
      return str('title')
    case 'check_subagent':
    case 'message_subagent':
    case 'stop_subagent':
      return str('id')
    case 'web_search':
      return str('query')
    case 'web_fetch':
      return str('url')
    case 'routines':
      return [str('action'), str('name') || str('id'), str('schedule')].filter(Boolean).join(' ')
    case 'transfer_file':
      return `${str('from_machine')}:${str('from_path')} → ${str('to_machine')}:${str('to_path')}`
    case 'orca_cli':
      return `orca ${Array.isArray(input.args) ? input.args.join(' ') : ''}`
    case 'list_machines':
      return input.probe_load === true ? 'with load' : ''
    default:
      return JSON.stringify(input)
  }
}

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
  const Icon = TOOL_ICONS[entry.tool] ?? Wrench
  const label = entry.tool.replace(/^mcp__\w+__/, '').replaceAll('_', ' ')
  const summary = toolSummary(entry)
  const expandable = Boolean(entry.output) || entry.tool === 'write_file'

  return (
    <div className="rounded-md border border-border text-xs" data-tool-status={entry.status}>
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
          {entry.tool === 'write_file' && (
            <pre className="scrollbar-sleek max-h-48 overflow-auto whitespace-pre-wrap font-mono text-muted-foreground">
              {String(entry.input.content ?? '')}
            </pre>
          )}
          {entry.output && (
            <pre className="scrollbar-sleek max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-foreground">
              {entry.output}
            </pre>
          )}
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
