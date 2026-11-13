import type { ReactNode } from 'react'
import { cn } from '@/lib/class-names'

/** Bordered section with an uppercase caption, shared by every Home summary. */
export function HomeOverviewPanel({
  title,
  action,
  children,
  className
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section className={cn('rounded-xl border border-border bg-card', className)}>
      <header className="flex h-9 items-center justify-between gap-2 border-b border-border px-3">
        <h2 className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  )
}

/** Full-width row button used by every clickable list row on Home. */
export function HomeOverviewRowButton({
  onClick,
  className,
  children
}: {
  onClick: () => void
  className?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className
      )}
    >
      {children}
    </button>
  )
}

export function HomeOverviewEmpty({ children }: { children: ReactNode }): React.JSX.Element {
  return <p className="px-3 py-4 text-xs text-muted-foreground">{children}</p>
}
