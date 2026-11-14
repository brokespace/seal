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

export type SessionRecapModel = {
  /** Null until the host has answered, and on a host from before recaps. */
  view: SessionRecapView | null
  refreshing: boolean
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
  // Answers land in the order asked: a slow read never replaces a newer one.
  const latest = useRef(0)

  const take = useCallback(
    (reading: Promise<SessionRecapView>): Promise<void> => {
      const asked = ++latest.current
      return reading.then(
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
    void take(refreshSessionRecap(client, sessionId)).then(() => setRefreshing(false))
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
      void take(markSessionRecapItem(client, { sessionId, itemId, mark: next }))
    },
    [client, sessionId, take]
  )

  return {
    view: held?.sessionId === sessionId ? held.view : null,
    refreshing,
    refresh,
    mark
  }
}
