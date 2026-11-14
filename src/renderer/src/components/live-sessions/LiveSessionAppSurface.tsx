import { useEffect, useRef } from 'react'
import { useLiveSessions, liveSessionRegistryStore } from './live-session-registry-store'
import { LiveSessionDialogs } from './menu/LiveSessionDialogs'
import { openLiveSessionView } from './menu/live-session-menu-effects'
import { liveSessionMarksStore } from './live-session-marks-store'
import { liveSessionTabsStore } from './workspace/live-session-tabs-store'

/** A session Seal launched moments ago: shown in Active agents the first time it is listed. */
const FRESH_LAUNCH_MS = 2 * 60_000

/** Mounted once: keeps session views on the registry's ids and hosts the dialogs session menus open. */
export function LiveSessionAppSurface(): React.JSX.Element | null {
  const { sessions, loaded } = useLiveSessions()
  const known = useRef<Set<string> | null>(null)

  useEffect(
    () =>
      liveSessionRegistryStore.onRename((from, to) => {
        known.current?.add(to)
        liveSessionTabsStore.rename(from, to)
        liveSessionMarksStore.rename(from, to)
      }),
    []
  )
  // A click on a session's desktop notification.
  useEffect(
    () =>
      window.api?.liveSessions?.onOpen?.(({ sessionId }) => openLiveSessionView(sessionId, 'tab')),
    []
  )
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
