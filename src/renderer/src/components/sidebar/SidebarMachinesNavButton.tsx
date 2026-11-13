import React from 'react'
import { Server } from 'lucide-react'
import { useAppStore } from '@/store/index'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'

export function SidebarMachinesNavButton(): React.JSX.Element {
  const t = useTranslate()
  const openMachinesPage = useAppStore((s) => s.openMachinesPage)
  const active = useAppStore((s) => s.activeView === 'machines')
  return (
    <button
      type="button"
      onClick={openMachinesPage}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
        active
          ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
          : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
      )}
    >
      <Server
        className={cn('size-4 shrink-0', !active && 'text-worktree-sidebar-foreground/30')}
        strokeWidth={active ? 2.25 : 1.75}
      />
      <span className="flex-1">{t('auto.components.sidebar.SidebarNav.machines', 'Machines')}</span>
    </button>
  )
}
