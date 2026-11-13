import { MessagesSquare } from 'lucide-react'
import { useAppStore } from '@/store/index'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'

export function LiveSessionsSidebarEntry(): React.JSX.Element {
  const t = useTranslate()
  const openSessionsPage = useAppStore((s) => s.openSessionsPage)
  const active = useAppStore((s) => s.activeView === 'sessions')
  return (
    <button
      type="button"
      onClick={openSessionsPage}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
        active
          ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
          : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
      )}
    >
      <MessagesSquare
        className={cn('size-4 shrink-0', !active && 'text-worktree-sidebar-foreground/30')}
        strokeWidth={active ? 2.25 : 1.75}
      />
      <span className="flex-1">
        {t('auto.components.live-sessions.LiveSessionsSidebarEntry.label', 'Agent sessions')}
      </span>
    </button>
  )
}
