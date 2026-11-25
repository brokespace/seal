import React from 'react'
import { cn } from '@/lib/class-names'

/** The header row of a sidebar section (Projects, Active agents): title, its collapse toggle, then actions. */
export function SidebarSectionHeader({
  title,
  section,
  tourTarget,
  toggle,
  actions,
  className
}: {
  title: string
  section: string
  tourTarget?: string
  toggle: React.ReactNode
  actions?: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'group/sidebar-header flex h-8 min-w-0 shrink-0 items-center justify-between gap-1.5 px-2',
        className
      )}
    >
      <div className="flex min-w-0 items-center" data-contextual-tour-target={tourTarget}>
        <span
          // Truncate localized titles because fixed-width actions cannot shrink inside the short header row.
          className="min-w-0 truncate select-none pl-2 pr-0.5 text-xs font-semibold text-muted-foreground/80"
          data-sidebar-section-title={section}
        >
          {title}
        </span>
        {toggle}
      </div>
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </div>
  )
}
