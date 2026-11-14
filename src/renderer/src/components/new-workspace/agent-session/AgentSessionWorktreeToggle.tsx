import React, { useId } from 'react'
import { Switch } from '@/components/ui/switch'
import { useTranslate } from '@/i18n/use-translate'

/** Off starts the agent in the project's own directory; on creates a worktree for it first. */
export function AgentSessionWorktreeToggle({
  checked,
  onCheckedChange
}: {
  checked: boolean
  onCheckedChange: (next: boolean) => void
}): React.JSX.Element {
  const t = useTranslate()
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
      <label htmlFor={id} className="min-w-0 cursor-pointer space-y-0.5">
        <span className="block text-xs font-medium text-foreground">
          {t('components.newAgentSession.createWorktree', 'Create worktree')}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {checked
            ? t(
                'components.newAgentSession.createWorktreeOn',
                'The agent starts in a new worktree on its own branch.'
              )
            : t(
                'components.newAgentSession.createWorktreeOff',
                'The agent starts in the project’s own directory.'
              )}
        </span>
      </label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="mt-0.5"
        data-testid="agent-session-create-worktree"
      />
    </div>
  )
}
