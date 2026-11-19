import { Button } from '@/components/ui/button'
import { cn } from '@/lib/class-names'
import type { AgentSessionPanel } from './agent-session-focus-requests'

/** A session header's toggle for one of the panels beside its chat. */
export function AgentSessionPanelButton({
  panel,
  active,
  count,
  attention,
  label,
  onToggle,
  children
}: {
  panel: AgentSessionPanel
  active: boolean
  /** What is running in it now, or with `attention` what waits on the user; zero shows none. */
  count: number | null
  /** What it counts waits on the user: the count is drawn in the attention color. */
  attention?: boolean
  label: string
  onToggle: (panel: AgentSessionPanel) => void
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
            attention ? 'text-agent-question-text' : 'text-agent-working'
          )}
        >
          {count}
        </span>
      ) : null}
    </Button>
  )
}
