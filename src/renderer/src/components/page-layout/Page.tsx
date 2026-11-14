import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/class-names'

/** The frame of a top-level page: a header row over a body that fills the rest. */
export function Page({ className, ...props }: ComponentProps<'main'>): React.JSX.Element {
  return (
    <main
      data-slot="page"
      className={cn(
        'relative flex h-full min-h-0 flex-1 flex-col bg-background pt-(--page-top-inset) text-foreground',
        className
      )}
      {...props}
    />
  )
}

/** Title on the left, the page's actions on the right, clear of the window controls. */
export function PageHeader({
  title,
  children,
  className
}: {
  title: ReactNode
  /** Actions and status, drawn after the title. */
  children?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <header
      data-slot="page-header"
      className={cn('flex shrink-0 items-center gap-2 px-(--page-gutter) pb-3', className)}
      style={{ paddingRight: 'max(var(--page-gutter), var(--window-controls-width, 0px))' }}
    >
      <h1 className="min-w-0 flex-1 truncate text-base leading-8 font-semibold">{title}</h1>
      {children}
    </header>
  )
}

/** A body of panes that meet the page edges, such as a list beside a detail view. */
export function PagePanes({ className, ...props }: ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="page-panes"
      className={cn('flex min-h-0 flex-1 border-t border-border', className)}
      {...props}
    />
  )
}

/** The inset column of a scrolling page; `readable` holds forms and prose to a comfortable measure. */
export function PageContent({
  width = 'full',
  className,
  ...props
}: ComponentProps<'div'> & { width?: 'full' | 'readable' }): React.JSX.Element {
  return (
    <div
      data-slot="page-content"
      data-width={width}
      className={cn(
        'mx-auto flex w-full flex-col gap-(--page-section-gap) px-(--page-gutter) pt-(--page-gutter) pb-(--page-gutter)',
        width === 'readable' &&
          // The measure excludes the gutters, so narrow windows keep them.
          'max-w-[calc(var(--page-readable-max-width)+2*var(--page-gutter))]',
        className
      )}
      {...props}
    />
  )
}

/** A scrolling body of sections and cards; a size container named `page` for its content. */
export function PageScrollBody({
  width,
  className,
  contentClassName,
  children,
  ...props
}: ComponentProps<'div'> & {
  width?: 'full' | 'readable'
  contentClassName?: string
}): React.JSX.Element {
  return (
    <div
      data-slot="page-scroll-body"
      className={cn(
        'scrollbar-sleek min-h-0 flex-1 overflow-y-auto border-t border-border [container:page/size]',
        className
      )}
      {...props}
    >
      <PageContent width={width} className={contentClassName}>
        {children}
      </PageContent>
    </div>
  )
}
