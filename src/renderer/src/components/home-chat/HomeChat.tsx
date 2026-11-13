import { Check, ChevronDown, MessageSquarePlus, Sparkles, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import type { HomeChatApi } from '../../../../preload/api/home-chat/home-chat-api'
import { HomeChatComposer } from './HomeChatComposer'
import { HomeChatConversation } from './HomeChatConversation'
import { HomeChatMemoryDialog } from './HomeChatMemoryDialog'
import { useHomeChat } from './use-home-chat'

function HomeChatPanel({
  api,
  className
}: {
  api: HomeChatApi
  className?: string
}): React.JSX.Element {
  const t = useTranslate()
  const state = useHomeChat(api)
  const { active, chats } = state

  return (
    <section
      className={cn('flex min-h-0 flex-col bg-background', className)}
      aria-label={t('homeChat.label', 'Seal assistant')}
    >
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="min-w-0 justify-start">
              <Sparkles className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-[13px] font-medium">
                {active?.title ?? t('homeChat.title', 'Assistant')}
              </span>
              {active?.parentChatId && (
                <Badge variant="referenceLabel">{t('homeChat.worker', 'Worker')}</Badge>
              )}
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            {chats.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                {t('homeChat.noChats', 'No chats yet')}
              </p>
            )}
            {chats.map((chat) => (
              <DropdownMenuItem key={chat.id} onSelect={() => state.select(chat.id)}>
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                {chat.parentChatId && (
                  <Badge variant="referenceLabel">{t('homeChat.worker', 'Worker')}</Badge>
                )}
                {chat.id === active?.id && <Check className="size-3.5" />}
              </DropdownMenuItem>
            ))}
            {active && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => state.remove(active.id)}>
                  <Trash2 className="size-3.5" />
                  {t('homeChat.delete', 'Delete this chat')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex-1" />
        <HomeChatMemoryDialog api={api} memoryVersion={state.memoryVersion} />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => void state.newChat()}
          aria-label={t('homeChat.new', 'New chat')}
        >
          <MessageSquarePlus />
        </Button>
      </header>

      {active && active.entries.length > 0 ? (
        <HomeChatConversation
          entries={active.entries}
          running={active.status === 'running'}
          onRespond={state.respondApproval}
          attachments={state.attachments}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-8 text-center">
          <p className="text-sm font-medium text-foreground">
            {t('homeChat.empty.title', 'Your machines, one chat')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              'homeChat.empty.capabilities',
              'Ask for anything that runs on this computer or your SSH hosts: start a dev server, move files, research something, schedule a check, or hand coding work to an agent in a worktree.'
            )}
          </p>
        </div>
      )}

      {state.error && (
        <div className="mx-3 mb-1 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-destructive">
          <span className="min-w-0 flex-1 whitespace-pre-wrap">{state.error}</span>
          <button
            type="button"
            className="cursor-pointer text-muted-foreground hover:text-foreground"
            onClick={state.dismissError}
            aria-label={t('homeChat.dismissError', 'Dismiss')}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <HomeChatComposer
        chat={active}
        settings={state.settings}
        accounts={state.accounts}
        onSend={state.send}
        onStop={state.stop}
        onUpdate={state.updateChat}
        onSaveSettings={state.saveSettings}
        onOpenAccounts={state.refreshAccounts}
      />
    </section>
  )
}

/** Self-contained home-page assistant; renders nothing where the desktop bridge is absent (web client). */
export default function HomeChat({ className }: { className?: string }): React.JSX.Element | null {
  const api = window.api.homeChat
  return api ? <HomeChatPanel api={api} className={className} /> : null
}
