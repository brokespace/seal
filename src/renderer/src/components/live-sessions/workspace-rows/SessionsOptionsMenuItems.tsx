import { useAppStore } from '@/store/index'
import { DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { liveSessionMarksStore, useLiveSessionMarks } from '../live-session-marks-store'

function openAgentSettings(): void {
  const store = useAppStore.getState()
  store.openSettingsPage()
  store.openSettingsTarget({ pane: 'agents', repoId: null })
}

/** What applies to every listed session: scan again, bulk selection, the idle and notification settings. */
export function SessionsOptionsMenuItems(): React.JSX.Element {
  const t = useTranslate()
  const marks = useLiveSessionMarks()
  return (
    <>
      <DropdownMenuLabel>
        {t('auto.components.live-sessions.sessionRows.toolbarTitle', 'Sessions')}
      </DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => void window.api.liveSessions?.refresh()}>
        {t('auto.components.live-sessions.LiveSessionsPage.refresh', 'Scan again')}
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => liveSessionMarksStore.setPicked(marks.picked ? null : new Set())}
      >
        {marks.picked
          ? t('auto.components.live-sessions.sidebar.stopPicking', 'Done selecting')
          : t('auto.components.live-sessions.sidebar.startPicking', 'Select sessions')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={openAgentSettings}>
        {t('auto.components.live-sessions.sidebar.settings', 'Idle sessions and notifications…')}
      </DropdownMenuItem>
    </>
  )
}
