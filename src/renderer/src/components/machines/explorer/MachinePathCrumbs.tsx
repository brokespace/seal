import React from 'react'
import { cn } from '@/lib/class-names'
import { machinePathCrumbs } from '../../../../../shared/machines/machine-paths'

/** A path as clickable segments; each one opens that folder. */
export function MachinePathCrumbs({
  path,
  label,
  onOpen,
  className
}: {
  path: string | null
  label: string
  onOpen: (path: string) => void
  className?: string
}): React.JSX.Element {
  return (
    <nav
      className={cn(
        'scrollbar-none flex min-w-0 flex-1 items-center overflow-x-auto px-1 font-mono text-xs',
        className
      )}
      aria-label={label}
    >
      {path
        ? machinePathCrumbs(path).map((crumb, index, crumbs) => (
            <React.Fragment key={crumb.path}>
              {index > 0 && crumbs[index - 1]?.label !== '/' ? (
                <span className="px-0.5 text-muted-foreground">/</span>
              ) : null}
              <button
                type="button"
                className={cn(
                  'shrink-0 rounded px-1 py-0.5 hover:bg-accent',
                  index === crumbs.length - 1 ? 'text-foreground' : 'text-muted-foreground'
                )}
                onClick={() => onOpen(crumb.path)}
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))
        : null}
    </nav>
  )
}
