import { MessageSquarePlus, X } from 'lucide-react'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '../ui/button'
import type { HomeChatApi } from '../../../../preload/api/home-chat/home-chat-api'
import { HomeChatComposer } from './HomeChatComposer'
import { HomeChatContextBar } from './HomeChatContextBar'
import { HomeChatConversation } from './HomeChatConversation'
import { HomeChatMemoryDialog } from './HomeChatMemoryDialog'
import { HomeChatThreadList } from './HomeChatThreadList'
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
        <HomeChatThreadList
          chats={chats}
          active={active}
          onSelect={state.select}
          onRename={state.rename}
          onDelete={state.remove}
        />
        <div className="flex-1" />
        <HomeChatMemoryDialog api={api} memoryVersion={state.memoryVersion} />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => void state.newChat()}
          aria-label={t('homeChat.new', 'New thread')}
        >
          <MessageSquarePlus />
        </Button>
      </header>
      <HomeChatContextBar
        chat={active}
        machines={state.machines}
        onOpenMachines={state.refreshMachines}
        onCompact={state.compact}
      />

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
              'Ask Seal for anything on this computer or any connected machine: run a command, move files, check on an agent session, switch accounts, or hand coding work to an agent in a worktree.'
            )}
          </p>
        </div>
      )}

      {state.error && (
        <div className="mx-4 mb-1 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-destructive">
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
