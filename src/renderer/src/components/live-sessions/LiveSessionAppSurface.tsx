import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store/index'
import { renameAgentSessionFocus } from './chat/agent-session-focus-requests'
import { liveSessionMarksStore } from './live-session-marks-store'
import { liveSessionTitle } from './live-session-presentation'
import { useLiveSessions, liveSessionRegistryStore } from './live-session-registry-store'
import { LiveSessionDialogs } from './menu/LiveSessionDialogs'
import {
  renameExternalAgentSessionTabs,
  setExternalAgentSessionTabLabel
} from './open/external-agent-session-tab'
import { migrateLegacyLiveSessionTabs } from './open/migrate-live-session-tabs'
import { openAgentSession } from './open/open-agent-session'

/** A session Seal launched moments ago: its row is revealed the first time it is listed. */
const FRESH_LAUNCH_MS = 2 * 60_000

/** Mounted once: keeps session tabs on the registry's ids and titles, and hosts the dialogs session menus open. */
export function LiveSessionAppSurface(): React.JSX.Element | null {
  const { sessions, loaded } = useLiveSessions()
  const workspacesReady = useAppStore((state) => state.workspaceSessionReady)
  const known = useRef<Set<string> | null>(null)
  const migrated = useRef(false)

  useEffect(
    () =>
      liveSessionRegistryStore.onRename((from, to) => {
        known.current?.add(to)
        renameExternalAgentSessionTabs(from, to)
        renameAgentSessionFocus(from, to)
        liveSessionMarksStore.rename(from, to)
      }),
    []
  )
  // A click on a session's desktop notification.
  useEffect(
    () => window.api?.liveSessions?.onOpen?.(({ sessionId }) => openAgentSession(sessionId, 'tab')),
    []
  )
  useEffect(() => {
    if (loaded && workspacesReady && !migrated.current) {
      migrated.current = true
      migrateLegacyLiveSessionTabs(sessions)
    }
  }, [sessions, loaded, workspacesReady])
  useEffect(() => {
    for (const session of sessions) {
      if (session.surface.kind === 'external') {
        setExternalAgentSessionTabLabel(session.id, liveSessionTitle(session))
      }
    }
  }, [sessions])
  useEffect(() => {
    if (!loaded) {
      return
    }
    liveSessionMarksStore.baseline(sessions)
    const seen = known.current
    known.current = new Set([...(seen ?? []), ...sessions.map((session) => session.id)])
    if (!seen) {
      return
    }
    const launched = sessions.find(
      (session) =>
        !seen.has(session.id) &&
        session.origin === 'seal' &&
        Date.now() - (session.startedAt ?? session.lastActivityAt) < FRESH_LAUNCH_MS
    )
    if (launched) {
      liveSessionMarksStore.reveal(launched.id)
    }
  }, [sessions, loaded])

  return <LiveSessionDialogs />
}
