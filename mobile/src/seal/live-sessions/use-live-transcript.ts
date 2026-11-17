import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { readLiveTranscriptPage } from './live-session-operations'
import { LiveTranscriptReaderHold } from '../../../../src/shared/live-sessions/live-transcript-reader-hold'
import type { NativeChatMessage } from '../../../../src/shared/native-chat/native-chat-types'
import {
  liveTranscriptFrameSchema,
  type LiveTranscriptDelta,
  type LiveTranscriptPage
} from './live-session-schemas'

type LiveTranscriptState = {
  phase: 'loading' | 'ready' | 'error'
  error: string | null
  messages: NativeChatMessage[]
  /** How far the transcript has been read, in bytes; null before the first read. */
  readTo: number | null
  hasMore: boolean
  /** The read of the page before the oldest loaded row; a failed one waits for a tap. */
  olderPages: 'idle' | 'loading' | 'failed'
}

type Held = {
  byId: Map<string, NativeChatMessage>
  cursor: number | null
  start: number | null
}

const offsetOf = (m: NativeChatMessage) => m.transcriptOffset ?? 0

function ordered(byId: Map<string, NativeChatMessage>): NativeChatMessage[] {
  return [...byId.values()].sort((a, b) => offsetOf(a) - offsetOf(b))
}

const LOADING: LiveTranscriptState = {
  phase: 'loading',
  error: null,
  messages: [],
  readTo: null,
  hasMore: false,
  olderPages: 'idle'
}

/**
 * Streams one session's transcript over `liveSessions.watchTranscript`. Messages are keyed by id, so a
 * page and a delta that overlap merge instead of doubling; a delta this view can't place re-attaches
 * from the cursor it holds.
 *
 * The host reads a session it does not list as empty, as it does right after a reconnect, before the
 * session's machine is scanned. Such a read is not shown: the watch opens again once `listed`.
 *
 * A newest page that would replace the rows a reader has scrolled away from waits until they are
 * back at the end; `retainHistory` is how the view says a reader left it.
 */
export function useLiveTranscript(
  client: RpcClient | null,
  sessionId: string | null,
  listed: boolean
): LiveTranscriptState & {
  loadEarlier: () => Promise<void>
  retry: () => void
  retainHistory: () => () => void
} {
  const held = useRef<Held>({ byId: new Map(), cursor: null, start: null })
  const [state, setState] = useState<LiveTranscriptState>(LOADING)
  const [hold] = useState(
    () =>
      new LiveTranscriptReaderHold((rows) => {
        held.current = { byId: rows.byId, cursor: rows.cursor, start: rows.start }
        setState((s) => ({
          ...s,
          phase: 'ready',
          error: null,
          messages: ordered(rows.byId),
          readTo: rows.cursor,
          hasMore: rows.more
        }))
      })
  )
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
        readTo: held.current.cursor,
        hasMore: hasMore ?? s.hasMore
      }))
    const readTo = () => hold.waitingCursor ?? held.current.cursor
    const applyPage = (page: LiveTranscriptPage) => {
      const read = readTo()
      // A watch replayed after a long gap brings a page that starts past the rows held: it can't join them.
      if (read !== null && page.start > read) {
        const byId = new Map(page.messages.map((m) => [m.id, m]))
        hold.replace(
          { byId, start: page.start, cursor: page.cursor, more: page.more },
          held.current.byId.size > 0
        )
        return
      }
      if (hold.append(page.messages, page.cursor)) {
        return
      }
      for (const m of page.messages) {
        held.current.byId.set(m.id, m)
      }
      held.current.cursor = page.cursor
      held.current.start = Math.min(held.current.start ?? page.start, page.start)
      publish(page.more)
    }
    const applyDelta = (delta: LiveTranscriptDelta) => {
      if (delta.reset) {
        const start = delta.messages[0] ? offsetOf(delta.messages[0]) : delta.cursor
        const byId = new Map(delta.messages.map((m) => [m.id, m]))
        hold.replace(
          { byId, start, cursor: delta.cursor, more: start > 0 },
          held.current.byId.size > 0
        )
        return
      }
      if (delta.from !== readTo()) {
        if (!closed) {
          setAttach((n) => n + 1)
        }
        return
      }
      if (hold.append(delta.messages, delta.cursor)) {
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
      { sessionId, fromCursor: readTo(), images: 'refs' },
      (raw) => {
        const parsed = liveTranscriptFrameSchema.safeParse(raw)
        if (closed || !parsed.success) {
          return
        }
        const frame = parsed.data
        if (frame.type === 'ready') {
          ready = true
          if (!frame.page) {
            publish()
          } else if (listed || frame.page.messages.length > 0) {
            applyPage(frame.page)
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
  }, [client, sessionId, attach, listed, hold])

  const loadEarlier = useCallback(async () => {
    const before = held.current.start
    if (!client || !sessionId || before === null || before === 0) {
      return
    }
    setState((s) => ({ ...s, olderPages: 'loading' }))
    try {
      const page = await readLiveTranscriptPage(client, sessionId, before)
      // The rows held were replaced while this read was out: its page is no longer the one before them.
      if (held.current.start !== before) {
        setState((s) => ({ ...s, olderPages: 'idle' }))
        return
      }
      for (const m of page.messages) {
        held.current.byId.set(m.id, m)
      }
      held.current.start = Math.min(before, page.start)
      setState((s) => ({
        ...s,
        messages: ordered(held.current.byId),
        hasMore: page.more,
        olderPages: 'idle'
      }))
    } catch {
      setState((s) => ({ ...s, olderPages: 'failed' }))
    }
  }, [client, sessionId])

  const retry = useCallback(() => setAttach((n) => n + 1), [])
  const retainHistory = useCallback(() => hold.retain(), [hold])
  return { ...state, loadEarlier, retry, retainHistory }
}
