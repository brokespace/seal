import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { LiveSessionPanel } from './live-session-tabs-store'

/** The panel beside a session's chat: a title, a close button, a scrolling body and an optional footer. */
export function LiveSessionSidePanel({
  panel,
  title,
  actions,
  footer,
  onClose,
  children
}: {
  panel: LiveSessionPanel
  title: string
  /** Controls set before the close button. */
  actions?: React.ReactNode
  footer?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <aside
      data-live-session-panel={panel}
      aria-label={title}
      className="flex w-80 shrink-0 flex-col border-l border-border bg-background"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        {actions}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label={t('auto.components.live-sessions.activity.close', 'Close panel')}
        >
          <X className="size-3.5" />
        </Button>
      </header>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto pb-3">{children}</div>
      {footer}
    </aside>
  )
}

export function LiveSessionPanelSectionTitle({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <h3 className="flex items-center gap-1.5 px-3 pt-3 pb-1 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

export function LiveSessionPanelEmpty({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return <p className="px-3 py-2 text-xs text-muted-foreground">{children}</p>
}
