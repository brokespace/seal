import { useState } from 'react'
import { Check, ChevronDown, Loader2, Pencil, Sparkles, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import type { HomeChatSummary } from '../../../../shared/home-chat/home-chat-types'
import { formatHomeChatAge } from './home-chat-format'

type RowMode = 'idle' | 'renaming' | 'deleting'

function ThreadRow({
  chat,
  active,
  onSelect,
  onRename,
  onDelete
}: {
  chat: HomeChatSummary
  active: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [mode, setMode] = useState<RowMode>('idle')
  const [draft, setDraft] = useState(chat.title)

  if (mode === 'renaming') {
    const commit = (): void => {
      const title = draft.trim()
      if (title && title !== chat.title) {
        onRename(title)
      }
      setMode('idle')
    }
    return (
      <div className="flex items-center gap-1 px-1 py-0.5">
        <Input
          autoFocus
          value={draft}
          density="compact"
          className="flex-1"
          aria-label={t('homeChat.threads.renameLabel', 'Thread name')}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit()
            } else if (event.key === 'Escape') {
              event.stopPropagation()
              setMode('idle')
            }
          }}
        />
      </div>
    )
  }

  if (mode === 'deleting') {
    return (
      <div className="flex items-center gap-1 rounded-md bg-muted/40 px-2 py-1 text-xs">
        <span className="min-w-0 flex-1 truncate text-foreground">
          {t('homeChat.threads.confirmDelete', 'Delete "{{title}}"?', { title: chat.title })}
        </span>
        <Button size="xs" variant="ghost" onClick={() => setMode('idle')}>
          {t('homeChat.threads.cancel', 'Cancel')}
        </Button>
        <Button size="xs" variant="destructive" onClick={onDelete}>
          {t('homeChat.threads.delete', 'Delete')}
        </Button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md pr-1 hover:bg-accent',
        active && 'bg-accent'
      )}
      data-home-chat-thread={chat.id}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-xs"
        onClick={onSelect}
      >
        {chat.status === 'running' ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : active ? (
          <Check className="size-3.5 shrink-0 text-foreground" />
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-foreground">{chat.title}</span>
        {chat.parentChatId && (
          <Badge variant="referenceLabel">{t('homeChat.worker', 'Worker')}</Badge>
        )}
        <span className="shrink-0 tabular-nums text-muted-foreground group-hover:hidden">
          {formatHomeChatAge(chat.updatedAt)}
        </span>
      </button>
      <div className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t('homeChat.threads.rename', 'Rename')}
          onClick={() => {
            setDraft(chat.title)
            setMode('renaming')
          }}
        >
          <Pencil />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t('homeChat.threads.delete', 'Delete')}
          onClick={() => setMode('deleting')}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  )
}

/** Every saved thread, newest first: pick one to resume it, or rename and delete from its row. */
export function HomeChatThreadList({
  chats,
  active,
  onSelect,
  onRename,
  onDelete
}: {
  chats: readonly HomeChatSummary[]
  active: HomeChatSummary | null
  onSelect: (chatId: string) => void
  onRename: (chatId: string, title: string) => void
  onDelete: (chatId: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 justify-start"
          aria-label={t('homeChat.threads.open', 'Threads')}
        >
          <Sparkles className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-[13px] font-medium">
            {active?.title ?? t('homeChat.title', 'Seal assistant')}
          </span>
          {active?.parentChatId && (
            <Badge variant="referenceLabel">{t('homeChat.worker', 'Worker')}</Badge>
          )}
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="p-1">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t('homeChat.threads.title', 'Threads')}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t('homeChat.threads.close', 'Close')}
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </div>
          <div className="scrollbar-sleek max-h-80 space-y-0.5 overflow-y-auto">
            {chats.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                {t('homeChat.noChats', 'No threads yet')}
              </p>
            )}
            {chats.map((chat) => (
              <ThreadRow
                key={chat.id}
                chat={chat}
                active={chat.id === active?.id}
                onSelect={() => {
                  onSelect(chat.id)
                  setOpen(false)
                }}
                onRename={(title) => onRename(chat.id, title)}
                onDelete={() => onDelete(chat.id)}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
