import HomeChat from '../home-chat/HomeChat'
import { useTranslate } from '@/i18n/use-translate'

/** The Seal assistant, given the full content width above the overview; absent without the desktop bridge. */
export function HomeChatSlot(): React.JSX.Element | null {
  const t = useTranslate()
  if (!window.api.homeChat) {
    return null
  }
  return (
    <section data-home-slot="chat" aria-label={t('home.overview.chat.label', 'Chat')}>
      <HomeChat className="h-[clamp(360px,60vh,800px)] overflow-hidden rounded-xl border border-border" />
    </section>
  )
}
