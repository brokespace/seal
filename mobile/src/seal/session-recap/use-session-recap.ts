import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type {
  LiveSessionRecapBrief,
  RecapItemMark,
  SessionRecapView
} from '../../../../src/shared/session-recap/session-recap-types'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import {
  markSessionRecapItem,
  readSessionRecap,
  refreshSessionRecap
} from './session-recap-operations'

/** Something the user asked of the recap that the host did not answer. */
export type SessionRecapFailure = 'refresh' | 'mark'

type SessionRecapModel = {
  /** Null until the host has answered, and on a host from before recaps. */
  view: SessionRecapView | null
  refreshing: boolean
  /** His last Refresh or tick got no answer; cleared when he tries again. */
  failed: SessionRecapFailure | null
  refresh: () => void
  mark: (itemId: string, mark: RecapItemMark | null) => void
}

function withMark(
  view: SessionRecapView,
  itemId: string,
  mark: RecapItemMark | null
): SessionRecapView {
  const { [itemId]: _had, ...rest } = view.marks
  return { ...view, marks: mark ? { ...rest, [itemId]: mark } : rest }
}

/**
 * One session's recap, read from the host the phone is paired with. Opening the session and coming
 * back to the app count as a visit; the session row's `rev` says when to read again.
 */
export function useSessionRecap(
  client: RpcClient | null,
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
  const take = useCallback(
    (reading: Promise<SessionRecapView>): Promise<boolean> => {
      const asked = ++latest.current
      return reading.then(
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
    if (!client) {
      return
    }
    void take(readSessionRecap(client, sessionId, true))
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void take(readSessionRecap(client, sessionId, true))
      }
    })
    return () => subscription.remove()
  }, [client, sessionId, take])

  const rev = brief?.rev
  const updating = brief?.updating === true
  useEffect(() => {
    if (client && rev !== undefined) {
      void take(readSessionRecap(client, sessionId, false))
    }
  }, [client, sessionId, take, rev, updating])

  const refresh = useCallback(() => {
    if (!client) {
      return
    }
    setRefreshing(true)
    setFailed(null)
    void take(refreshSessionRecap(client, sessionId)).then((answered) => {
      setRefreshing(false)
      if (!answered) {
        setFailed({ sessionId, what: 'refresh' })
      }
    })
  }, [client, sessionId, take])

  const mark = useCallback(
    (itemId: string, next: RecapItemMark | null) => {
      if (!client) {
        return
      }
      setHeld((current) =>
        current?.sessionId === sessionId
          ? { sessionId, view: withMark(current.view, itemId, next) }
          : current
      )
      setFailed(null)
      void take(markSessionRecapItem(client, { sessionId, itemId, mark: next })).then(
        (answered) => {
          if (!answered) {
            setFailed({ sessionId, what: 'mark' })
            // The tick shown was never saved: show what the host holds.
            void take(readSessionRecap(client, sessionId, false))
          }
        }
      )
    },
    [client, sessionId, take]
  )

  return {
    view: held?.sessionId === sessionId ? held.view : null,
    refreshing,
    failed: failed?.sessionId === sessionId ? failed.what : null,
    refresh,
    mark
  }
}
