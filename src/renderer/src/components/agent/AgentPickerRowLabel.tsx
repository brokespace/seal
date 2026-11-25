import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import { DropdownMenuShortcut } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/class-names'
import type { AgentPickerEntry } from '../../../../shared/agent-launch/picker/agent-launch-picker'

/** An agent row's icon and name, then what trails them: why the launch waits, or its shortcut. */
export function AgentPickerRowLabel({
  agent,
  label,
  shortcut,
  reason,
  reasonId,
  besideActions
}: {
  agent: AgentPickerEntry['agent']
  label: string
  shortcut?: string
  reason?: string
  reasonId: string
  /** The row's surface actions share its width, so a reason takes the room the name leaves. */
  besideActions: boolean
}): React.JSX.Element {
  const reasonTakesRoom = besideActions && !!reason
  return (
    <>
      <AgentIcon agent={agent} size={14} />
      <span className={cn('min-w-0 truncate text-left', !reasonTakesRoom && 'flex-1')}>
        {label}
      </span>
      {shortcut && !reasonTakesRoom ? (
        // Why: beside the surface actions the name gives way first; a shortcut wider than the room left is cut, never drawn over the actions.
        <span className="min-w-0 truncate text-muted-foreground">
          <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>
        </span>
      ) : null}
      {reason ? (
        <span
          id={reasonId}
          className={cn(
            'min-w-0 truncate text-xs text-muted-foreground',
            besideActions ? 'flex-1 text-right' : 'shrink'
          )}
        >
          {reason}
        </span>
      ) : null}
    </>
  )
}
