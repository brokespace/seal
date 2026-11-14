import { Button } from '@/components/ui/button'
import { cn } from '@/lib/class-names'
import type { LiveSessionPanel } from './live-session-tabs-store'

/** A session header's toggle for one of the panels beside its chat. */
export function PanelButton({
  panel,
  active,
  count,
  running,
  attention,
  label,
  onToggle,
  children
}: {
  panel: LiveSessionPanel
  active: boolean
  count: number | null
  /** Something in it is still going: the count is drawn in the working color. */
  running: boolean
  /** What it counts waits on the user: the count is drawn in the attention color. */
  attention?: boolean
  label: string
  onToggle: (panel: LiveSessionPanel) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      size="xs"
      aria-pressed={active}
      aria-label={label}
      title={label}
      data-live-session-panel-toggle={panel}
      onClick={() => onToggle(panel)}
    >
      {children}
      {/* A split pane has no room for the words. */}
      <span className="hidden @2xl:inline">{label}</span>
      {count ? (
        <span
          className={cn(
            'tabular-nums',
            running ? 'text-agent-working' : attention ? 'text-agent-question-text' : 'opacity-70'
          )}
        >
          {count}
        </span>
      ) : null}
    </Button>
  )
}
