import { useEffect, useMemo, useState } from 'react'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import { sessionMachineName } from '@/components/machines/model/use-local-machine-name'
import {
  matchPaletteExtraFields,
  type PaletteExtraResult,
  type PaletteExtraSource
} from '@/components/cmd-j/palette-extra-results'
import {
  compareLiveSessions,
  isActiveLiveSession
} from '../../../../../shared/live-sessions/live-session-status'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import {
  liveSessionProviderLabel,
  liveSessionStatusText,
  liveSessionTitle
} from '../live-session-presentation'
import { useLiveSessions } from '../live-session-registry-store'
import { LiveSessionStatusPill } from '../status/LiveSessionStatusPill'
import { openLiveSessionView } from '../menu/live-session-menu-effects'
import { RECENTLY_FINISHED_MS } from '../active-agents/active-agents-model'

/** The palette's rows for sessions: running ones first, then those that ended in the last day. */
export function liveSessionPaletteResults(
  sessions: readonly LiveSession[],
  query: string,
  now: number,
  open: (sessionId: string) => void
): PaletteExtraResult[] {
  const listed = sessions
    .filter(
      (session) =>
        isActiveLiveSession(session) || now - session.lastActivityAt <= RECENTLY_FINISHED_MS
    )
    .sort(
      (a, b) =>
        Number(isActiveLiveSession(b)) - Number(isActiveLiveSession(a)) || compareLiveSessions(a, b)
    )
  const typed = query.trim() !== ''
  return listed.flatMap((session, order) => {
    const title = liveSessionTitle(session)
    const where = [sessionMachineName(session.machine), session.project]
      .filter(Boolean)
      .join(' \u00b7 ')
    const match = typed
      ? matchPaletteExtraFields(
          session.id,
          [
            { id: 'title', text: title, role: 'primary' },
            { id: 'where', text: where, role: 'secondary' },
            { id: 'agent', text: liveSessionProviderLabel(session), role: 'secondary' },
            { id: 'status', text: liveSessionStatusText(session), role: 'secondary' }
          ],
          query
        )
      : null
    if (typed && !match) {
      return []
    }
    return [
      {
        id: `live-session:${session.id}`,
        title,
        titleRanges: match?.rangesByField.get('title') ?? [],
        rank: match?.rank ?? null,
        qualityClass: match?.qualityClass ?? null,
        lastActiveAt: session.lastActivityAt,
        order,
        dimmed: !isActiveLiveSession(session),
        leading: <AgentIcon agent={session.provider} size={14} />,
        line: <LiveSessionStatusPill session={session} />,
        trailing: where ? (
          <span className="truncate text-xs text-muted-foreground">{where}</span>
        ) : null,
        onSelect: () => open(session.id)
      }
    ]
  })
}

/** "Go to agent session": every live session, from Cmd+J. */
export function useLiveSessionPaletteSource(args: {
  query: string
  visible: boolean
}): PaletteExtraSource | null {
  const { sessions } = useLiveSessions()
  const { query, visible } = args
  const [now, setNow] = useState(() => Date.now())
  // "The last day" is measured from when the palette opened.
  useEffect(() => {
    if (visible) {
      setNow(Date.now())
    }
  }, [visible])
  return useMemo(() => {
    if (!visible || sessions.length === 0) {
      return null
    }
    return {
      id: 'live-sessions',
      sectionLabel: (t) =>
        t('auto.components.live-sessions.palette.section', 'Go to agent session'),
      emptyQueryCap: 5,
      emptyQueryPlacement: 'last',
      typedPlacement: 'after-workspaces',
      leadsOnTie: false,
      results: liveSessionPaletteResults(sessions, query, now, (sessionId) =>
        openLiveSessionView(sessionId, 'tab')
      )
    }
  }, [sessions, query, visible, now])
}
