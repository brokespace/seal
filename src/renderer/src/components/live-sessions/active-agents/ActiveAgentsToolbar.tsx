import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type { LiveSessionDangerKind } from '../menu/live-session-menu'
import type { ActiveAgentsChip, ActiveAgentsFilter } from './active-agents-model'

const CHIPS: readonly ActiveAgentsChip[] = ['attention', 'working', 'mine']

export type ActiveAgentsToolbarProps = {
  ui: ActiveAgentsFilter & { picked: ReadonlySet<string> | null }
  /** The picked sessions still listed. */
  pickedSessions: readonly LiveSession[]
  onQuery: (query: string) => void
  onChip: (chip: ActiveAgentsChip) => void
  onClearScope: () => void
  onBulk: (danger: LiveSessionDangerKind, sessions: LiveSession[]) => void
  onStopPicking: () => void
  /** Arrow-down from the search field moves into the list. */
  onEnterList: () => void
}

/** Above the Active agents list: search, quick filters, the Projects scope, and bulk actions. */
export function ActiveAgentsToolbar(props: ActiveAgentsToolbarProps): React.JSX.Element {
  const t = useTranslate()
  const { ui, pickedSessions } = props
  const chipLabel: Record<ActiveAgentsChip, string> = {
    attention: t('auto.components.live-sessions.sidebar.chipAttention', 'Needs attention'),
    working: t('auto.components.live-sessions.sidebar.chipWorking', 'Working'),
    mine: t('auto.components.live-sessions.sidebar.chipMine', 'This machine')
  }
  const chipTitle: Partial<Record<ActiveAgentsChip, string>> = {
    mine: t('auto.components.live-sessions.sidebar.chipMineTitle', 'Mine, on this machine')
  }
  return (
    <div className="flex flex-col gap-1 px-1 pb-1">
      <div className="relative">
        <Input
          type="text"
          role="searchbox"
          density="compact"
          adornment={ui.query ? 'trailing' : 'none'}
          value={ui.query}
          data-active-agents-search
          onChange={(event) => props.onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              props.onEnterList()
            } else if (event.key === 'Escape' && ui.query) {
              event.stopPropagation()
              props.onQuery('')
            }
          }}
          placeholder={t(
            'auto.components.live-sessions.sidebar.search',
            'Filter by name, project, machine, agent, status'
          )}
          aria-label={t('auto.components.live-sessions.sidebar.searchLabel', 'Filter sessions')}
        />
        {ui.query ? (
          <button
            type="button"
            onClick={() => props.onQuery('')}
            aria-label={t('auto.components.live-sessions.sidebar.clearSearch', 'Clear filter')}
            className="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {CHIPS.map((chip) => {
          const on = ui.chips.has(chip)
          return (
            <button
              key={chip}
              type="button"
              aria-pressed={on}
              title={chipTitle[chip]}
              data-active-agents-chip={chip}
              onClick={() => props.onChip(chip)}
              className={cn(
                'h-5 rounded-full border px-2 text-2xs leading-none transition-colors focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring focus-visible:outline-none',
                on
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-worktree-sidebar-border text-muted-foreground hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground'
              )}
            >
              {chipLabel[chip]}
            </button>
          )
        })}
        {ui.scope ? (
          <button
            type="button"
            data-active-agents-scope={ui.scope.kind}
            onClick={props.onClearScope}
            title={t('auto.components.live-sessions.sidebar.clearScope', 'Show all sessions')}
            className="flex h-5 max-w-full min-w-0 items-center gap-1 rounded-full bg-agent-working/15 px-2 text-2xs leading-none text-foreground focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring focus-visible:outline-none"
          >
            <span className="min-w-0 truncate">{ui.scope.label}</span>
            <X className="size-3 shrink-0" />
          </button>
        ) : null}
      </div>
      {ui.picked ? (
        <div
          data-active-agents-bulk
          className="flex flex-wrap items-center gap-1 rounded-md border border-worktree-sidebar-border px-1.5 py-1"
        >
          <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
            {t('auto.components.live-sessions.sidebar.pickedCount', '{{count}} selected', {
              count: pickedSessions.length
            })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={pickedSessions.length === 0}
            onClick={() => props.onBulk('stop', [...pickedSessions])}
          >
            {t('auto.components.live-sessions.sidebar.bulkStop', 'Stop')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={pickedSessions.length === 0}
            onClick={() => props.onBulk('stop-and-remove', [...pickedSessions])}
          >
            {t('auto.components.live-sessions.sidebar.bulkRemove', 'Remove')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={pickedSessions.length === 0}
            onClick={() => props.onBulk('delete-with-transcripts', [...pickedSessions])}
          >
            {t('auto.components.live-sessions.sidebar.bulkDelete', 'Delete')}
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={props.onStopPicking}>
            {t('auto.components.live-sessions.dialog.cancel', 'Cancel')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
