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

/** Something the user asked of the recap that the host did not answer. */
export type SessionRecapFailure = 'refresh' | 'mark'

export type SessionRecapModel = {
  /** Null until the host has answered once. */
  view: SessionRecapView | null
  /** The user's own Refresh is on its way. */
  refreshing: boolean
  /** His last Refresh or tick got no answer; cleared when he tries again. */
  failed: SessionRecapFailure | null
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
  const [failed, setFailed] = useState<{ sessionId: string; what: SessionRecapFailure } | null>(
    null
  )
  // Answers land in the order asked: a slow read never replaces a newer one.
  const latest = useRef(0)

  /** Resolves to whether the host answered. */
  const read = useCallback(
    (method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<boolean> => {
      const asked = ++latest.current
      return callRuntimeRpc<SessionRecapView>(
        LOCAL_TARGET,
        method,
        { sessionId, ...params },
        // No feature-interaction tag: these methods take strict params and reject the extra key.
        { timeoutMs }
      ).then(
        (view) => {
          if (asked === latest.current) {
            setHeld({ sessionId, view })
          }
          return true
        },
        () => false
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
  const hadBrief = useRef(false)
  useEffect(() => {
    // A pass that ends without a recap takes the brief away again: read why it ended.
    if (rev !== undefined || hadBrief.current) {
      void read('sessionRecap.get', {})
    }
    hadBrief.current = rev !== undefined
  }, [read, rev, updating])

  const refresh = useCallback(() => {
    setRefreshing(true)
    setFailed(null)
    void read('sessionRecap.refresh', {}, REFRESH_TIMEOUT_MS).then((answered) => {
      setRefreshing(false)
      if (!answered) {
        setFailed({ sessionId, what: 'refresh' })
      }
    })
  }, [read, sessionId])

  const mark = useCallback(
    (itemId: string, next: RecapItemMark | null) => {
      setHeld((current) =>
        current?.sessionId === sessionId
          ? { sessionId, view: withMark(current.view, itemId, next) }
          : current
      )
      setFailed(null)
      void read('sessionRecap.mark', { itemId, mark: next }).then((answered) => {
        if (!answered) {
          setFailed({ sessionId, what: 'mark' })
          // The tick shown was never saved: show what the host holds.
          void read('sessionRecap.get', {})
        }
      })
    },
    [read, sessionId]
  )

  return {
    view: held?.sessionId === sessionId ? held.view : null,
    refreshing,
    failed: failed?.sessionId === sessionId ? failed.what : null,
    refresh,
    mark
  }
}
