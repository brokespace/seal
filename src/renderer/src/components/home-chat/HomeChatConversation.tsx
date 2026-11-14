import { useLayoutEffect, useRef, useState } from 'react'
import { AlertCircle, ChevronRight, Dot } from 'lucide-react'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import CommentMarkdown from '../sidebar/CommentMarkdown'
import type { HomeChatEntry } from '../../../../shared/home-chat/home-chat-types'
import { HomeChatAttachment, type HomeChatAttachmentActions } from './HomeChatAttachment'
import { HomeChatCompactionDivider } from './HomeChatCompactionDivider'
import { HomeChatNotice } from './HomeChatNotice'
import { HomeChatToolCall } from './HomeChatToolCall'
import { formatHomeChatDuration } from './home-chat-format'

type ThinkingEntry = Extract<HomeChatEntry, { kind: 'thinking' }>

function Thinking({ entry }: { entry: ThinkingEntry }): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const label = entry.streaming
    ? t('homeChat.thinking.live', 'Thinking…')
    : entry.durationMs !== undefined
      ? t('homeChat.thinking.done', 'Thought for {{duration}}', {
          duration: formatHomeChatDuration(entry.durationMs)
        })
      : t('homeChat.thinking.brief', 'Thought briefly')
  return (
    <div className="text-xs text-muted-foreground">
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1 hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        {label}
      </button>
      {open && <p className={cn('mt-1 whitespace-pre-wrap pl-4.5', PROSE_MEASURE)}>{entry.text}</p>}
    </div>
  )
}

function Entry({
  entry,
  onRespond,
  attachments
}: {
  entry: HomeChatEntry
  onRespond: (entryId: string, approved: boolean) => void
  attachments: HomeChatAttachmentActions
}): React.JSX.Element | null {
  const t = useTranslate()
  switch (entry.kind) {
    case 'user':
      return (
        <div className="flex flex-col items-end gap-1">
          <div
            className="max-w-[min(85%,72rem)] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm text-foreground"
            data-home-chat-user
          >
            {entry.text}
          </div>
          {entry.delivery === 'failed' && (
            <span className="text-2xs text-destructive">{t('homeChat.notSent', 'Not sent')}</span>
          )}
        </div>
      )
    case 'assistant':
      return entry.text ? (
        <CommentMarkdown
          className={cn('text-sm text-foreground', MARKDOWN_PROSE_MEASURE)}
          content={entry.text}
          variant="document"
          growing={entry.streaming}
        />
      ) : null
    case 'thinking':
      return entry.text || entry.streaming ? <Thinking entry={entry} /> : null
    case 'tool':
      return <HomeChatToolCall entry={entry} onRespond={(ok) => onRespond(entry.id, ok)} />
    case 'progress':
      return (
        <p className="flex items-center text-xs text-muted-foreground">
          <Dot className="size-4 shrink-0" />
          {entry.text}
        </p>
      )
    case 'error':
      return (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          <span className="whitespace-pre-wrap">{entry.text}</span>
        </p>
      )
    case 'compaction':
      return <HomeChatCompactionDivider entry={entry} />
    case 'notice':
      return <HomeChatNotice entry={entry} />
    case 'attachment':
      return <HomeChatAttachment entry={entry} actions={attachments} />
  }
}

const STICK_TO_BOTTOM_PX = 48

// Why: running text stays a readable measure on very wide panels; code, tables and tool cards keep the full width.
const PROSE_MEASURE = 'max-w-[72rem]'
const MARKDOWN_PROSE_MEASURE = '[&>:is(p,ul,ol,blockquote,h1,h2,h3,h4,h5,h6)]:max-w-[72rem]'

export function HomeChatConversation({
  entries,
  running,
  onRespond,
  attachments
}: {
  entries: readonly HomeChatEntry[]
  running: boolean
  onRespond: (entryId: string, approved: boolean) => void
  attachments: HomeChatAttachmentActions
}): React.JSX.Element {
  const t = useTranslate()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)

  // Follow new output only while the reader is already at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [entries])

  const last = entries.at(-1)
  // An approval card is waiting on the user, not on the assistant.
  const waiting =
    running &&
    (!last ||
      last.kind === 'user' ||
      last.kind === 'notice' ||
      (last.kind === 'tool' && last.status !== 'awaiting-approval'))

  return (
    <div
      ref={scrollRef}
      className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-4 py-4"
      onScroll={(event) => {
        const el = event.currentTarget
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX
      }}
    >
      <div className="flex flex-col gap-3" data-home-chat-messages>
        {entries.map((entry) => (
          <Entry key={entry.id} entry={entry} onRespond={onRespond} attachments={attachments} />
        ))}
        {waiting && (
          <p className="text-xs text-muted-foreground">{t('homeChat.working', 'Working…')}</p>
        )}
      </div>
    </div>
  )
}
