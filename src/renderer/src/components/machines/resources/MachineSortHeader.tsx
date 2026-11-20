import React from 'react'
import { cn } from '@/lib/class-names'

/** A column title that sorts its list; the arrow says which way while it is the active column. */
export function MachineSortHeader({
  label,
  active,
  className,
  onSort,
  descending = true
}: {
  label: string
  active: boolean
  className?: string
  onSort: () => void
  descending?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(className, 'font-medium hover:text-foreground', active && 'text-foreground')}
      aria-pressed={active}
      onClick={onSort}
    >
      {label}
      {active ? (descending ? ' ↓' : ' ↑') : ''}
    </button>
  )
}
