import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { liveSessionMarksStore, useLiveSessionMarks } from '../live-session-marks-store'
import { useLiveSessions } from '../live-session-registry-store'
import type { LiveSessionDangerKind } from '../menu/live-session-menu'
import { liveSessionMenuEffects } from '../menu/live-session-menu-effects'

const BULK_ACTIONS = [
  'stop',
  'stop-and-remove',
  'delete-with-transcripts'
] as const satisfies readonly LiveSessionDangerKind[]

function SessionSelectionBarView({
  pickedSessions
}: {
  /** The picked sessions the registry still has. */
  pickedSessions: readonly LiveSession[]
}): React.JSX.Element {
  const t = useTranslate()
  const labels: Record<(typeof BULK_ACTIONS)[number], string> = {
    stop: t('auto.components.live-sessions.sidebar.bulkStop', 'Stop'),
    'stop-and-remove': t('auto.components.live-sessions.sidebar.bulkRemove', 'Remove'),
    'delete-with-transcripts': t('auto.components.live-sessions.sidebar.bulkDelete', 'Delete')
  }
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-worktree-sidebar-border px-1.5 py-1">
      <span className="flex-1 shrink-0 text-2xs whitespace-nowrap text-muted-foreground">
        {t('auto.components.live-sessions.sidebar.pickedCount', '{{count}} selected', {
          count: pickedSessions.length
        })}
      </span>
      {BULK_ACTIONS.map((danger) => (
        <Button
          key={danger}
          type="button"
          variant="ghost"
          size="xs"
          disabled={pickedSessions.length === 0}
          onClick={() => liveSessionMenuEffects.confirm(danger, [...pickedSessions])}
        >
          {labels[danger]}
        </Button>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => liveSessionMarksStore.setPicked(null)}
      >
        {t('auto.components.live-sessions.dialog.cancel', 'Cancel')}
      </Button>
    </div>
  )
}

/** While selecting: how many sessions are picked and what to do with all of them. */
export function SessionSelectionBar(): React.JSX.Element | null {
  const { picked } = useLiveSessionMarks()
  const { sessions } = useLiveSessions()
  const pickedSessions = useMemo(() => {
    const byId = new Map(sessions.map((session) => [session.id, session]))
    return [...(picked ?? [])].flatMap((id) => byId.get(id) ?? [])
  }, [picked, sessions])
  return picked ? <SessionSelectionBarView pickedSessions={pickedSessions} /> : null
}
