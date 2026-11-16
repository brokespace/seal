import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { openLiveSessionFromRow } from '../menu/live-session-menu-effects'
import { LiveSessionRow, type LiveSessionRowProps } from './LiveSessionRow'
import { useLiveSessionRowState } from './use-live-session-row-state'

/**
 * Session rows on a page or panel: the row, state, menu and open handler Active agents uses, so a
 * session reads and acts the same wherever it is listed.
 */
export function LiveSessionRows({
  sessions,
  label,
  now,
  tone = 'surface',
  layout,
  showPlace,
  menu
}: {
  sessions: readonly LiveSession[]
  /** Names the list for assistive tech. */
  label: string
  now: number
  tone?: LiveSessionRowProps['tone']
  layout?: LiveSessionRowProps['layout']
  showPlace?: LiveSessionRowProps['showPlace']
  menu?: LiveSessionRowProps['menu']
}): React.JSX.Element {
  const rowState = useLiveSessionRowState()
  return (
    // A list on its page, not a popup: Escape and arrow keys stay with the page around it.
    <div
      role="listbox"
      data-focus-behavior="page"
      aria-label={label}
      className="flex min-w-0 flex-col"
    >
      {sessions.map((session) => (
        <LiveSessionRow
          key={session.id}
          session={session}
          {...rowState(session)}
          picked={null}
          // No arrow-key roving here, so Tab reaches every row.
          tabStop
          now={now}
          tone={tone}
          layout={layout}
          showPlace={showPlace}
          onOpen={openLiveSessionFromRow}
          // Only Active agents multi-selects; elsewhere a modified click still opens.
          onPick={(picked) => openLiveSessionFromRow(picked)}
          menu={menu}
        />
      ))}
    </div>
  )
}
