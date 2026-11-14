import { useCallback, useEffect, useRef, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type {
  LiveSessionRecapBrief,
  RecapItemMark,
  SessionRecapView
} from '../../../../shared/session-recap/session-recap-types'

const LOCAL_TARGET: RuntimeClientTarget = { kind: 'local' }
/** A rebuild reads up to three chunks, each one model call that may be retried once. */
const REFRESH_TIMEOUT_MS = 6 * 60_000

export type SessionRecapModel = {
  /** Null until the host has answered once. */
  view: SessionRecapView | null
  /** The user's own Refresh is on its way. */
  refreshing: boolean
  refresh: () => void
  mark: (itemId: string, mark: RecapItemMark | null) => void
}

function withMark(view: SessionRecapView, itemId: string, mark: RecapItemMark | null) {
  const { [itemId]: _had, ...rest } = view.marks
  return { ...view, marks: mark ? { ...rest, [itemId]: mark } : rest }
}

/**
 * One open session's recap. Opening it, and coming back to the window, count as a visit: the host
 * brings a stale recap up to date then. The session row's `rev` says when to read it again.
 */
export function useSessionRecap(
  sessionId: string,
  brief: LiveSessionRecapBrief | undefined
): SessionRecapModel {
  const [held, setHeld] = useState<{ sessionId: string; view: SessionRecapView } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // Answers land in the order asked: a slow read never replaces a newer one.
  const latest = useRef(0)

  const read = useCallback(
    (method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<void> => {
      const asked = ++latest.current
      return callRuntimeRpc<SessionRecapView>(
        LOCAL_TARGET,
        method,
        { sessionId, ...params },
        { suppressFeatureInteraction: true, timeoutMs }
      ).then(
        (view) => {
          if (asked === latest.current) {
            setHeld({ sessionId, view })
          }
        },
        () => {}
      )
    },
    [sessionId]
  )

  useEffect(() => {
    void read('sessionRecap.get', { look: true })
    const onFocus = (): void => void read('sessionRecap.get', { look: true })
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [read])

  const rev = brief?.rev
  const updating = brief?.updating === true
  useEffect(() => {
    if (rev !== undefined) {
      void read('sessionRecap.get', {})
    }
  }, [read, rev, updating])

  const refresh = useCallback(() => {
    setRefreshing(true)
    void read('sessionRecap.refresh', {}, REFRESH_TIMEOUT_MS).then(() => setRefreshing(false))
  }, [read])

  const mark = useCallback(
    (itemId: string, next: RecapItemMark | null) => {
      setHeld((current) =>
        current?.sessionId === sessionId
          ? { sessionId, view: withMark(current.view, itemId, next) }
          : current
      )
      void read('sessionRecap.mark', { itemId, mark: next })
    },
    [read, sessionId]
  )

  return {
    view: held?.sessionId === sessionId ? held.view : null,
    refreshing,
    refresh,
    mark
  }
}
