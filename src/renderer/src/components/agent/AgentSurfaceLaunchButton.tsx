import React from 'react'
import { MessageSquare, SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { surfaceActionLabel } from '../tab-bar/tab-agent-row-presentation'

type AgentSurfaceLaunchButtonProps = Omit<React.ComponentProps<'button'>, 'children' | 'title'> & {
  title: string
  /** The surface this button opens. */
  surface: 'terminal' | 'chat'
  /** Why it cannot start; the button keeps its action as its name and stays focusable so the reason can be read. */
  reason?: string
}

const ROW_NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'])

/** Tab and Shift+Tab walk a menu row and the surface buttons inside it. */
export function moveAgentRowActionFocus(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) {
    return
  }
  const row = event.currentTarget
  const stops = [
    row,
    ...row.querySelectorAll<HTMLElement>('[data-agent-surface-action]:not(:disabled)')
  ]
  const at = event.target instanceof HTMLElement ? stops.indexOf(event.target) : -1
  if (at === -1 || stops.length < 2) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  stops[(at + (event.shiftKey ? stops.length - 1 : 1)) % stops.length].focus()
}

/** A labelled control on an agent's row that starts the agent on one surface: Chat or CLI. */
export function AgentSurfaceLaunchButton({
  title,
  surface,
  reason,
  className,
  onClick,
  onKeyDown,
  ...props
}: AgentSurfaceLaunchButtonProps): React.JSX.Element {
  const t = useTranslate()
  return (
    // Why: the button stays focusable so its reason can be read, so the dimming sits on a wrapper.
    <span className={cn('-my-0.5 flex shrink-0', reason && 'opacity-50')}>
      <Button
        type="button"
        variant="muted-field-icon"
        size="xs"
        tabIndex={-1}
        data-agent-surface-action={surface}
        title={reason ?? title}
        aria-label={title}
        aria-description={reason}
        aria-disabled={reason ? true : undefined}
        className={className}
        {...props}
        onClick={(event) => {
          if (reason) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          onClick?.(event)
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          const row = event.currentTarget.closest<HTMLElement>('[role="menuitem"]')
          if (event.defaultPrevented || !row) {
            return
          }
          if (event.key === 'Enter' || event.key === ' ') {
            // Stopped so the row's own Enter handling does not start the row's surface instead.
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.click()
          } else if (ROW_NAVIGATION_KEYS.has(event.key)) {
            event.preventDefault()
            event.stopPropagation()
            row.focus()
            // Why: roving focus ignores keys from inside an item, so the row replays the move.
            if (event.key !== 'ArrowLeft') {
              row.dispatchEvent(
                new window.KeyboardEvent('keydown', { key: event.key, bubbles: true })
              )
            }
          }
        }}
      >
        {surface === 'chat' ? <MessageSquare /> : <SquareTerminal />}
        {surfaceActionLabel(surface, t)}
      </Button>
    </span>
  )
}
