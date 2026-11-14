import React from 'react'
import { cn } from '@/lib/class-names'

/** Horizontal inset of a top-level page; nested toolbars and panes use it to stay on the page's edges. */
export const PAGE_GUTTER_X = 'px-(--page-gutter)'

/** The frame of a top-level page: full width and height, with one responsive gutter for everything in it. */
export function PageLayout({
  className,
  ...props
}: React.ComponentProps<'main'>): React.JSX.Element {
  return (
    <main
      className={cn(
        'relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background pt-5 text-foreground [--page-gutter:0.75rem] md:pt-6 md:[--page-gutter:1.25rem]',
        className
      )}
      {...props}
    />
  )
}

/** The page's title row; `children` are its actions. A string title renders as the page heading. */
export function PageHeader({
  title,
  children,
  className,
  topOfWindow = false
}: {
  title: React.ReactNode
  children?: React.ReactNode
  className?: string
  /** The page has no titlebar strip above it, so the header shares its row with the window controls. */
  topOfWindow?: boolean
}): React.JSX.Element {
  return (
    <header
      className={cn('flex shrink-0 items-center gap-2 pb-3', PAGE_GUTTER_X, className)}
      style={
        topOfWindow
          ? { paddingRight: 'max(var(--page-gutter), var(--window-controls-width, 0px))' }
          : undefined
      }
    >
      {typeof title === 'string' ? <PageTitle>{title}</PageTitle> : title}
      {children}
    </header>
  )
}

export function PageTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h1 className="min-w-0 flex-1 truncate text-base leading-8 font-semibold">{children}</h1>
}

/** The region under the header for pages that lay out their own panes (list + detail). */
export function PagePanes({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('flex min-h-0 flex-1 border-t border-border', className)} {...props} />
}

/** The region under the header for a page that is one scrolling column of content. */
export function PageScrollContent({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto border-t border-border">
      <div className={cn('flex w-full flex-col pt-4 pb-16', PAGE_GUTTER_X, className)}>
        {children}
      </div>
    </div>
  )
}
