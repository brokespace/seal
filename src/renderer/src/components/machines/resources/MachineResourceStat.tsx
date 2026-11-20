import React from 'react'
import { cn } from '@/lib/class-names'

/** One headline figure above a resource detail. */
export function MachineResourceStat({
  label,
  value,
  detail,
  className
}: {
  label: string
  value: string
  detail?: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-3xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="truncate font-mono text-sm tabular-nums">{value}</div>
      {detail ? <div className="truncate text-2xs text-muted-foreground">{detail}</div> : null}
    </div>
  )
}

export function MachineResourceStats({
  children,
  columns = 4
}: {
  children: React.ReactNode
  /** How many figures share a row once the panel is wide enough for one row of them. */
  columns?: 4 | 5
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-x-6 gap-y-3',
        columns === 5 ? '@lg:grid-cols-3 @2xl:grid-cols-5' : '@lg:grid-cols-4'
      )}
    >
      {children}
    </div>
  )
}

/** One named reading in a card's list of them. */
export function MachineResourceFact({
  label,
  value,
  title
}: {
  label: string
  value: string
  title?: string
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2" title={title}>
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono tabular-nums">{value}</dd>
    </div>
  )
}
