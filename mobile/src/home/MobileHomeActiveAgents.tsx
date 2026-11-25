import { memo } from 'react'
import { LIST_LEADING_INSET, ListGroup } from '../components/list/ListGroup'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { LiveSessionRow } from '../seal/live-sessions/LiveSessionRow'
import { useLiveSessionOpener } from '../seal/live-sessions/LiveSessionsHostList'
import type { DesktopLiveSession } from '../seal/live-sessions/paired-desktop-sessions'
import { MobileHomeSectionHeading } from './MobileHomeSectionHeading'

// Enough to act on without pushing Desktops off the first screen; the Agents tab has the rest.
const ACTIVE_ROWS_SHOWN = 3

/** Feed's short list of sessions waiting on the user or working, those waiting first; hidden when none are. */
export const MobileHomeActiveAgents = memo(function MobileHomeActiveAgents(props: {
  sessions: readonly DesktopLiveSession[]
  onSeeAll: () => void
}) {
  const t = useMobileTranslation()
  if (props.sessions.length === 0) {
    return null
  }
  return (
    <>
      <MobileHomeSectionHeading
        title={t('home.activeAgents.heading', 'Active')}
        count={props.sessions.length}
        aside={t('home.activeAgents.seeAll', 'See all agents')}
        onAsidePress={props.onSeeAll}
        first
      />
      <ListGroup separatorInset={LIST_LEADING_INSET}>
        {props.sessions.slice(0, ACTIVE_ROWS_SHOWN).map((session) => (
          <ActiveSessionRow key={`${session.desktopHostId}\0${session.id}`} session={session} />
        ))}
      </ListGroup>
    </>
  )
})

function ActiveSessionRow({ session }: { session: DesktopLiveSession }) {
  const { open, openingId } = useLiveSessionOpener(session.desktopHostId)
  return (
    <LiveSessionRow
      session={session}
      listTestId="home-active-session"
      opening={openingId === session.id}
      onPress={open}
    />
  )
}
