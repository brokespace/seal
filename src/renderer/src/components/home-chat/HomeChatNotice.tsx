import { useState } from 'react'
import {
  Bot,
  CalendarClock,
  ChevronRight,
  ShieldAlert,
  Terminal,
  type LucideIcon
} from 'lucide-react'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import type {
  HomeChatEntry,
  HomeChatNoticeSource
} from '../../../../shared/home-chat/home-chat-types'

type NoticeEntry = Extract<HomeChatEntry, { kind: 'notice' }>

const NOTICE_ICONS: Record<HomeChatNoticeSource, LucideIcon> = {
  job: Terminal,
  subagent: Bot,
  routine: CalendarClock,
  approval: ShieldAlert
}

/** Something that finished or fired on its own; the assistant's reaction follows below it. */
export function HomeChatNotice({ entry }: { entry: NoticeEntry }): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const Icon = NOTICE_ICONS[entry.source]
  const [headline, ...rest] = entry.text.split('\n')
  const details = rest.join('\n').trim()
  const label = {
    job: t('homeChat.notice.job', 'Background job'),
    subagent: t('homeChat.notice.subagent', 'Subagent'),
    routine: t('homeChat.notice.routine', 'Routine'),
    approval: t('homeChat.notice.approval', 'Waiting for you')
  }[entry.source]

  return (
    <div
      className="rounded-md border border-border bg-muted/40 text-xs"
      data-notice-source={entry.source}
    >
      <button
        type="button"
        className={cn(
          'flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left',
          details && 'cursor-pointer hover:bg-accent'
        )}
        onClick={() => details && setOpen((v) => !v)}
        aria-expanded={details ? open : undefined}
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium text-foreground">{label}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={headline}>
          {headline}
        </span>
        {details && (
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90'
            )}
          />
        )}
      </button>
      {open && (
        <pre className="scrollbar-sleek max-h-64 overflow-auto whitespace-pre-wrap break-all border-t border-border px-2.5 py-2 font-mono text-foreground">
          {details}
        </pre>
      )}
    </div>
  )
}
