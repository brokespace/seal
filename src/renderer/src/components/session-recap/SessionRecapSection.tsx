import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/class-names'
import { AgentSessionPanelSectionTitle } from '@/components/live-sessions/chat/AgentSessionSidePanel'

/** One titled list of the recap panel. */
export function RecapPanelSection({
  name,
  title,
  count,
  icon,
  children
}: {
  name: string
  title: string
  count?: number
  icon?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section data-recap-section={name}>
      <AgentSessionPanelSectionTitle>
        {icon}
        <span>{title}</span>
        {count ? <span className="font-normal tabular-nums opacity-70">{count}</span> : null}
      </AgentSessionPanelSectionTitle>
      {children}
    </section>
  )
}

/** Rows kept behind a line that says how many there are. */
export function RecapFold({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
        className="flex cursor-pointer items-center gap-1 rounded-sm px-3 py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        {label}
      </button>
      {open ? children : null}
    </>
  )
}
