import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type { LiveSessionDangerKind } from '../menu/live-session-menu'
import type { ActiveAgentsScope } from './active-agents-model'

export type ActiveAgentsToolbarProps = {
  scope: ActiveAgentsScope | null
  picked: ReadonlySet<string> | null
  /** The picked sessions still listed. */
  pickedSessions: readonly LiveSession[]
  onClearScope: () => void
  onBulk: (danger: LiveSessionDangerKind, sessions: LiveSession[]) => void
  onStopPicking: () => void
}

/** Above the Active agents list while it is narrowed or selecting: the Projects scope and bulk actions. */
export function ActiveAgentsToolbar(props: ActiveAgentsToolbarProps): React.JSX.Element | null {
  const t = useTranslate()
  const { scope, picked, pickedSessions } = props
  if (!scope && !picked) {
    return null
  }
  return (
    <div className="flex flex-col gap-1 px-1 pb-1">
      {scope ? (
        <button
          type="button"
          data-active-agents-scope={scope.kind}
          onClick={props.onClearScope}
          title={t('auto.components.live-sessions.sidebar.clearScope', 'Show all sessions')}
          className="flex h-5 max-w-full min-w-0 items-center gap-1 self-start rounded-full bg-agent-working/15 px-2 text-2xs leading-none text-foreground focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring focus-visible:outline-none"
        >
          <span className="min-w-0 truncate">{scope.label}</span>
          <X className="size-3 shrink-0" />
        </button>
      ) : null}
      {picked ? (
        <div
          data-active-agents-bulk
          className="flex flex-wrap items-center gap-1 rounded-md border border-worktree-sidebar-border px-1.5 py-1"
        >
          <span className="flex-1 shrink-0 text-2xs whitespace-nowrap text-muted-foreground">
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
