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
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-3 @lg:grid-cols-4">{children}</div>
}
