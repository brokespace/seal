import { useCallback, useEffect, useRef, useState } from 'react'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import type {
  LiveTranscriptDelta,
  LiveTranscriptPage
} from '../../../../shared/live-sessions/live-session-types'
import type { NativeChatOlderPageResult } from '../native-chat/viewport/history/native-chat-pagination'

export type LiveTranscriptState = {
  phase: 'loading' | 'ready' | 'error'
  error: string | null
  messages: NativeChatMessage[]
  hasMore: boolean
  loadingEarlier: boolean
}

type Held = { byId: Map<string, NativeChatMessage>; cursor: number | null; start: number | null }

const offsetOf = (m: NativeChatMessage) => m.transcriptOffset ?? 0

function ordered(byId: Map<string, NativeChatMessage>): NativeChatMessage[] {
  return [...byId.values()].sort((a, b) => offsetOf(a) - offsetOf(b))
}

/**
 * Streams one session's transcript. Messages are keyed by byte offset, so a page and a delta that
 * overlap merge instead of doubling; after a gap or a dropped stream it re-attaches from its cursor.
 */
export function useLiveTranscript(sessionId: string | null): LiveTranscriptState & {
  loadEarlier: () => Promise<NativeChatOlderPageResult>
} {
  const held = useRef<Held>({ byId: new Map(), cursor: null, start: null })
  const [state, setState] = useState<LiveTranscriptState>({
    phase: 'loading',
    error: null,
    messages: [],
    hasMore: false,
    loadingEarlier: false
  })
  const [attach, setAttach] = useState(0)

  useEffect(() => {
    const api = window.api?.liveSessions
    if (!sessionId || !api) {
      return
    }
    let watchId: string | null = null
    let closed = false
    const early: LiveTranscriptDelta[] = []
    const publish = (hasMore?: boolean) =>
      setState((s) => ({
        ...s,
        phase: 'ready',
        error: null,
        messages: ordered(held.current.byId),
        hasMore: hasMore ?? s.hasMore
      }))
    const applyPage = (page: LiveTranscriptPage) => {
      for (const m of page.messages) {
        held.current.byId.set(m.id, m)
      }
      held.current.cursor = page.cursor
      held.current.start = Math.min(held.current.start ?? page.start, page.start)
      publish(page.more)
    }
    const applyDelta = (delta: LiveTranscriptDelta) => {
      if (delta.reset) {
        held.current.byId = new Map(delta.messages.map((m) => [m.id, m]))
        held.current.cursor = delta.cursor
        held.current.start = delta.messages.length ? offsetOf(delta.messages[0]) : delta.cursor
        publish(held.current.start > 0)
        return
      }
      if (delta.from !== held.current.cursor) {
        // A delta this view can't place: re-attach from the cursor it holds.
        if (!closed) {
          setAttach((n) => n + 1)
        }
        return
      }
      for (const m of delta.messages) {
        held.current.byId.set(m.id, m)
      }
      held.current.cursor = delta.cursor
      publish()
    }
    const off = api.onTranscriptDelta(({ watchId: id, delta }) => {
      if (closed || delta.sessionId !== sessionId) {
        return
      }
      if (watchId === null) {
        early.push(delta)
      } else if (id === watchId) {
        applyDelta(delta)
      }
    })
    void api
      .watchTranscript({ sessionId, fromCursor: held.current.cursor })
      .then(({ watchId: id, page }) => {
        if (closed) {
          void api.unwatchTranscript({ watchId: id })
          return
        }
        watchId = id
        if (page) {
          applyPage(page)
        } else {
          publish()
        }
        for (const delta of early.splice(0)) {
          applyDelta(delta)
        }
      })
      .catch((error: unknown) => {
        if (!closed) {
          setState((s) => ({
            ...s,
            phase: 'error',
            error: error instanceof Error ? error.message : String(error)
          }))
        }
      })
    return () => {
      closed = true
      off()
      if (watchId) {
        void api.unwatchTranscript({ watchId })
      }
    }
  }, [sessionId, attach])

  const loadEarlier = useCallback(async (): Promise<NativeChatOlderPageResult> => {
    const api = window.api?.liveSessions
    const before = held.current.start
    if (!sessionId || !api || before === null || before === 0) {
      return 'exhausted'
    }
    setState((s) => ({ ...s, loadingEarlier: true }))
    try {
      const page = await api.transcriptPage({ sessionId, before })
      for (const m of page.messages) {
        held.current.byId.set(m.id, m)
      }
      held.current.start = Math.min(before, page.start)
      setState((s) => ({
        ...s,
        messages: ordered(held.current.byId),
        hasMore: page.more,
        loadingEarlier: false
      }))
      return page.messages.length ? 'applied' : 'exhausted'
    } catch {
      setState((s) => ({ ...s, loadingEarlier: false }))
      return 'failed'
    }
  }, [sessionId])

  return { ...state, loadEarlier }
}
