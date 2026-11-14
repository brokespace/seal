import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { readLiveTranscriptPage } from './live-session-operations'
import {
  liveTranscriptFrameSchema,
  type LiveTranscriptDelta,
  type LiveTranscriptMessage,
  type LiveTranscriptPage
} from './live-session-schemas'

export type LiveTranscriptState = {
  phase: 'loading' | 'ready' | 'error'
  error: string | null
  messages: LiveTranscriptMessage[]
  hasMore: boolean
  loadingEarlier: boolean
}

type Held = {
  byId: Map<string, LiveTranscriptMessage>
  cursor: number | null
  start: number | null
}

const offsetOf = (m: LiveTranscriptMessage) => m.transcriptOffset ?? 0

function ordered(byId: Map<string, LiveTranscriptMessage>): LiveTranscriptMessage[] {
  return [...byId.values()].sort((a, b) => offsetOf(a) - offsetOf(b))
}

const LOADING: LiveTranscriptState = {
  phase: 'loading',
  error: null,
  messages: [],
  hasMore: false,
  loadingEarlier: false
}

/**
 * Streams one session's transcript over `liveSessions.watchTranscript`. Messages are keyed by id, so a
 * page and a delta that overlap merge instead of doubling; a delta this view can't place re-attaches
 * from the cursor it holds.
 */
export function useLiveTranscript(
  client: RpcClient | null,
  sessionId: string | null
): LiveTranscriptState & { loadEarlier: () => Promise<void>; retry: () => void } {
  const held = useRef<Held>({ byId: new Map(), cursor: null, start: null })
  const [state, setState] = useState<LiveTranscriptState>(LOADING)
  const [attach, setAttach] = useState(0)

  useEffect(() => {
    if (!client || !sessionId) {
      return
    }
    let closed = false
    let ready = false
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
        held.current.start = delta.messages[0] ? offsetOf(delta.messages[0]) : delta.cursor
        publish(held.current.start > 0)
        return
      }
      if (delta.from !== held.current.cursor) {
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
    const close = client.subscribe(
      'liveSessions.watchTranscript',
      { sessionId, fromCursor: held.current.cursor },
      (raw) => {
        const parsed = liveTranscriptFrameSchema.safeParse(raw)
        if (closed || !parsed.success) {
          return
        }
        const frame = parsed.data
        if (frame.type === 'ready') {
          ready = true
          if (frame.page) {
            applyPage(frame.page)
          } else {
            publish()
          }
          for (const delta of early.splice(0)) {
            applyDelta(delta)
          }
        } else if (frame.type === 'delta') {
          if (frame.delta.sessionId !== sessionId) {
            return
          }
          if (ready) {
            applyDelta(frame.delta)
          } else {
            early.push(frame.delta)
          }
        } else if (frame.type === 'error') {
          setState((s) => ({ ...s, phase: 'error', error: frame.message ?? null }))
        }
      }
    )
    return () => {
      closed = true
      close()
    }
  }, [client, sessionId, attach])

  const loadEarlier = useCallback(async () => {
    const before = held.current.start
    if (!client || !sessionId || before === null || before === 0) {
      return
    }
    setState((s) => ({ ...s, loadingEarlier: true }))
    try {
      const page = await readLiveTranscriptPage(client, sessionId, before)
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
    } catch {
      setState((s) => ({ ...s, loadingEarlier: false }))
    }
  }, [client, sessionId])

  const retry = useCallback(() => setAttach((n) => n + 1), [])
  return { ...state, loadEarlier, retry }
}
