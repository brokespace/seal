import { MessageSquare } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'

/**
 * Mount point for the Home chat box (built on the seal/home-chat branch). Render the chat component
 * in place of the placeholder below; Home gives this slot the full content width above the overview.
 */
export function HomeChatSlot(): React.JSX.Element {
  const t = useTranslate()
  return (
    <section data-home-slot="chat" aria-label={t('home.overview.chat.label', 'Chat')}>
      <div className="flex h-12 items-center gap-2 rounded-xl border border-dashed border-border px-4 text-sm text-muted-foreground">
        <MessageSquare className="size-4 shrink-0" />
        <span>{t('home.overview.chat.placeholder', 'Chat with your agents is coming soon.')}</span>
      </div>
    </section>
  )
}
