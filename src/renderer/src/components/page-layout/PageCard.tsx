import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/class-names'

const CAPTION_CLASS = 'text-2xs font-semibold tracking-wider text-muted-foreground uppercase'

/** Page content under a caption; `inline` puts a short strip beside its caption. */
export function PageSection({
  label,
  caption = label,
  inline = false,
  children,
  className
}: {
  label: string
  /** The caption as drawn, when it carries more than the label (a count). */
  caption?: ReactNode
  inline?: boolean
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section
      data-slot="page-section"
      aria-label={label}
      className={cn(
        'flex min-w-0 gap-3',
        inline ? 'min-h-12 items-center' : 'flex-col gap-2',
        className
      )}
    >
      <h2 className={cn('shrink-0', CAPTION_CLASS)}>{caption}</h2>
      {children}
    </section>
  )
}

/** A bordered card with a caption and an optional action in its header. */
export function PageCard({
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
    <section
      data-slot="page-card"
      className={cn('min-w-0 rounded-xl border border-border bg-card', className)}
    >
      <header className="flex h-9 items-center justify-between gap-2 border-b border-border px-3">
        <h2 className={CAPTION_CLASS}>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  )
}

/** Cards in as many equal columns as fit the width they are given. */
export function PageCardGrid({ className, ...props }: ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="page-card-grid"
      className={cn(
        'grid grid-cols-[repeat(auto-fill,minmax(min(var(--page-card-min-width),100%),1fr))] items-start gap-(--page-section-gap)',
        className
      )}
      {...props}
    />
  )
}
