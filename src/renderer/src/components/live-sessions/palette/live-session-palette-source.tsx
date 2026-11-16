import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store/index'
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
import { isAgentSessionSurfaceTab, type Tab } from '../../../../../shared/tab-types'
import {
  liveSessionProviderLabel,
  liveSessionStatusText,
  liveSessionTitle
} from '../live-session-presentation'
import { useLiveSessions } from '../live-session-registry-store'
import { LiveSessionStatusPill } from '../status/LiveSessionStatusPill'
import { openAgentSession } from '../open/open-agent-session'
import { RECENTLY_FINISHED_MS } from '../row/live-session-machine-listing'

/** What a session's workspace tab goes by: a chat by its chat, an agent in a pane by its terminal tab, one started outside Seal by its record. */
function liveSessionTabKey(session: Pick<LiveSession, 'id' | 'surface'>): string | null {
  const { surface } = session
  if (surface.kind === 'chat') {
    return `agent-session:${surface.sessionId}`
  }
  if (surface.kind === 'external') {
    return `external-agent-session:${session.id}`
  }
  if (surface.kind !== 'cli') {
    return null
  }
  const separator = surface.paneKey.lastIndexOf(':')
  return separator > 0 ? `terminal:${surface.paneKey.slice(0, separator)}` : null
}

type SessionTab = Pick<Tab, 'contentType' | 'entityId'>

/** The session and terminal tabs open in any workspace, which Open Tabs lists itself. */
export function openSessionTabKeys(
  unifiedTabsByWorktree: Readonly<Record<string, readonly SessionTab[] | undefined>>
): Set<string> {
  const keys = new Set<string>()
  for (const tabs of Object.values(unifiedTabsByWorktree)) {
    for (const tab of tabs ?? []) {
      if (isAgentSessionSurfaceTab(tab.contentType) || tab.contentType === 'terminal') {
        keys.add(`${tab.contentType}:${tab.entityId}`)
      }
    }
  }
  return keys
}

/**
 * The palette's rows for sessions: running ones first, then those that ended in the last day. A
 * session whose tab is open is left to that tab's own row, so the palette lists it once.
 */
export function liveSessionPaletteResults(
  sessions: readonly LiveSession[],
  query: string,
  now: number,
  openTabKeys: ReadonlySet<string>,
  open: (sessionId: string) => void
): PaletteExtraResult[] {
  const listed = sessions
    .filter(
      (session) =>
        (isActiveLiveSession(session) || now - session.lastActivityAt <= RECENTLY_FINISHED_MS) &&
        !openTabKeys.has(liveSessionTabKey(session) ?? '')
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

/** "Go to agent session" in Cmd+J: the live sessions that no open tab already stands for. */
export function useLiveSessionPaletteSource(args: {
  query: string
  visible: boolean
}): PaletteExtraSource | null {
  const { sessions } = useLiveSessions()
  const unifiedTabsByWorktree = useAppStore((state) => state.unifiedTabsByWorktree)
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
      results: liveSessionPaletteResults(
        sessions,
        query,
        now,
        openSessionTabKeys(unifiedTabsByWorktree),
        (sessionId) => openAgentSession(sessionId, 'tab')
      )
    }
  }, [sessions, query, visible, now, unifiedTabsByWorktree])
}
