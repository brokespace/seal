import HomeChat from '../home-chat/HomeChat'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { useHomeChatMinimized } from './home-chat-minimized-preference'

/** The Seal assistant, above the overview or beside it on wide windows; absent without the desktop bridge. */
export function HomeChatSlot(): React.JSX.Element | null {
  const t = useTranslate()
  const [minimized, setMinimized] = useHomeChatMinimized()
  if (!window.api.homeChat) {
    return null
  }
  return (
    <section
      data-home-slot="chat"
      data-minimized={minimized ? 'true' : undefined}
      aria-label={t('home.overview.chat.label', 'Chat')}
      // Beside the overview the chat stays in view at the height of the page body.
      className={cn(
        'min-w-0',
        !minimized && '@min-[96rem]/page:sticky @min-[96rem]/page:top-(--page-gutter)'
      )}
    >
      <HomeChat
        className={cn(
          'overflow-hidden rounded-xl border border-border',
          !minimized &&
            'h-[clamp(24rem,72cqh,56rem)] @min-[96rem]/page:h-[calc(100cqh-2*var(--page-gutter))]'
        )}
        minimized={minimized}
        onMinimizedChange={setMinimized}
      />
    </section>
  )
}
