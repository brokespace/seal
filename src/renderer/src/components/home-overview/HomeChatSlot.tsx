import HomeChat from '../home-chat/HomeChat'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { useHomeChatMinimized } from './home-chat-minimized-preference'

/** The Seal assistant, given the full content width above the overview; absent without the desktop bridge. */
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
    >
      <HomeChat
        className={cn(
          'overflow-hidden rounded-xl border border-border',
          !minimized && 'h-[clamp(360px,55vh,640px)]'
        )}
        minimized={minimized}
        onMinimizedChange={setMinimized}
      />
    </section>
  )
}
