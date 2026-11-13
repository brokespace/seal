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

export function HomeOverviewEmpty({ children }: { children: ReactNode }): React.JSX.Element {
  return <p className="px-3 py-4 text-xs text-muted-foreground">{children}</p>
}
