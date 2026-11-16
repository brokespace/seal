import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/class-names'

/** The fold mark of a line that hides rows: it points down while they show. */
export function FoldChevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <ChevronRight
      className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
      aria-hidden="true"
    />
  )
}
