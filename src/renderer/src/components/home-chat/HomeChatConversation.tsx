import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Dot } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { NATIVE_CHAT_TRANSCRIPT_COLUMN_CLASS } from '../native-chat/appearance/native-chat-appearance-style'
import { MessageRow } from '../native-chat/messages/rows/NativeChatMessageRow'
import { NativeChatJumpToLatest } from '../native-chat/viewport/scroll/NativeChatJumpToLatest'
import type { HomeChatEntry } from '../../../../shared/home-chat/home-chat-types'
import { HomeChatAttachment, type HomeChatAttachmentActions } from './HomeChatAttachment'
import { HomeChatCompactionDivider } from './HomeChatCompactionDivider'
import { HomeChatNotice } from './HomeChatNotice'
import { HomeChatToolCall } from './HomeChatToolCall'
import { homeChatTranscriptRows, type HomeChatTranscriptRow } from './home-chat-transcript-rows'

function scrollRowToTop(row: HTMLElement): void {
  row.scrollIntoView({ block: 'start' })
}

/** What the user and the assistant said, drawn by the session transcript's own row. */
function Message({
  row
}: {
  row: Extract<HomeChatTranscriptRow, { kind: 'message' }>
}): React.JSX.Element {
  const t = useTranslate()
  const { entry, message } = row
  if (entry.kind === 'user') {
    return (
      <div data-home-chat-user>
        <MessageRow
          message={message}
          expandSignal={false}
          onScrollMessageToTop={scrollRowToTop}
          deliveryNotice={
            entry.delivery === 'sending'
              ? { sending: true }
              : entry.delivery === 'failed'
                ? { text: t('homeChat.notSent', 'Not sent') }
                : undefined
          }
        />
      </div>
    )
  }
  return (
    <MessageRow
      message={message}
      expandSignal={false}
      onScrollMessageToTop={scrollRowToTop}
      activeTurnIsWorking={entry.streaming}
      trailingRun={entry.streaming}
      endsResponse={row.endsResponse}
      latestResponse={row.latestResponse}
      // Hover-only actions of an earlier response take no room of their own.
      actionsHang={row.endsResponse && !row.latestResponse}
    />
  )
}

function Entry({
  entry,
  attachments
}: {
  entry: Extract<HomeChatTranscriptRow, { kind: 'entry' }>['entry']
  attachments: HomeChatAttachmentActions
}): React.JSX.Element {
  switch (entry.kind) {
    case 'progress':
      return (
        <p className="flex items-center text-xs text-chat-foreground-faint">
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
  const columnRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)
  const [awayFromEnd, setAwayFromEnd] = useState(false)
  const rows = useMemo(() => homeChatTranscriptRows(entries), [entries])

  // Follow new output only while the reader is already at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [entries])

  // Paced replies and resized panes change the height after their entry arrived.
  useEffect(() => {
    const el = scrollRef.current
    const column = columnRef.current
    if (!el || !column || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => {
      if (stickRef.current) {
        el.scrollTop = el.scrollHeight
      }
    })
    observer.observe(el)
    observer.observe(column)
    return () => observer.disconnect()
  }, [])

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current
    if (el) {
      stickRef.current = true
      el.scrollTop = el.scrollHeight
    }
  }, [])

  const last = entries.at(-1)
  // An approval card is waiting on the user, not on the assistant.
  const waiting =
    running &&
    (!last ||
      last.kind === 'user' ||
      last.kind === 'notice' ||
      (last.kind === 'thinking' && !last.text) ||
      (last.kind === 'tool' && last.status !== 'awaiting-approval'))

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-3 py-5 [scrollbar-gutter:stable_both-edges] sm:px-4"
        onScroll={(event) => {
          const el = event.currentTarget
          const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX
          stickRef.current = atEnd
          setAwayFromEnd(!atEnd)
        }}
      >
        <div ref={columnRef} className={NATIVE_CHAT_TRANSCRIPT_COLUMN_CLASS}>
          {rows.map((row) =>
            row.kind === 'message' ? (
              <Message key={row.entry.id} row={row} />
            ) : row.kind === 'tools' ? (
              <div key={row.entries[0].id} className="flex flex-col gap-1.5">
                {row.entries.map((entry) => (
                  <HomeChatToolCall
                    key={entry.id}
                    entry={entry}
                    onRespond={(approved) => onRespond(entry.id, approved)}
                  />
                ))}
              </div>
            ) : (
              <Entry key={row.entry.id} entry={row.entry} attachments={attachments} />
            )
          )}
          {waiting && (
            <p className="text-xs text-chat-foreground-faint">
              {t('homeChat.working', 'Working…')}
            </p>
          )}
        </div>
      </div>
      <NativeChatJumpToLatest visible={awayFromEnd} onJump={jumpToLatest} />
    </div>
  )
}
