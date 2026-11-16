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
  /** The row's surface actions share its width, so the name keeps its room before anything trailing it. */
  besideActions: boolean
}): React.JSX.Element {
  const nameFirst = besideActions && (!!reason || !!shortcut)
  return (
    <>
      <AgentIcon agent={agent} size={14} />
      <span className={cn('min-w-0 truncate text-left', !nameFirst && 'flex-1')}>{label}</span>
      {shortcut && !besideActions ? <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut> : null}
      {shortcut && besideActions && !reason ? (
        // Why: a shortcut that does not fit beside the name wraps onto a clipped second line instead of crowding it.
        <span className="flex h-4 min-w-0 flex-1 flex-wrap justify-end overflow-hidden">
          <span className="h-4" />
          <DropdownMenuShortcut className="ml-1">{shortcut}</DropdownMenuShortcut>
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
