import { Ellipsis } from 'lucide-react'
import { useAppStore } from '@/store/index'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { liveSessionMarksStore, useLiveSessionMarks } from '../live-session-marks-store'

export type SessionsOptionsMenuProps = { label: string } & Omit<
  React.ComponentProps<typeof Button>,
  'aria-label' | 'children' | 'variant' | 'size' | 'type' | 'asChild'
>

function openAgentSettings(): void {
  const store = useAppStore.getState()
  store.openSettingsPage()
  store.openSettingsTarget({ pane: 'agents', repoId: null })
}

/** What applies to every listed session: scan again, bulk selection, the idle and notification settings. */
export function SessionsOptionsMenu({
  label,
  ...trigger
}: SessionsOptionsMenuProps): React.JSX.Element {
  const t = useTranslate()
  const marks = useLiveSessionMarks()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={label} {...trigger}>
          <Ellipsis className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={openAgentSettings}>
          {t('auto.components.live-sessions.sidebar.settings', 'Idle sessions and notifications…')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
