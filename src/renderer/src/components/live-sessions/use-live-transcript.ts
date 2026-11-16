import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import type { LiveTranscriptDelta } from '../../../../shared/live-sessions/live-session-types'
import type { NativeChatOlderPageResult } from '../native-chat/viewport/history/native-chat-pagination'
import { liveTranscriptFeed, type AgentSessionTranscriptFeed } from './chat/live-transcript-feed'

export type LiveTranscriptState = {
  phase: 'loading' | 'ready' | 'error'
  error: string | null
  messages: NativeChatMessage[]
  /** How far the transcript has been read, in bytes; null before the first read. */
  readTo: number | null
  hasMore: boolean
  loadingEarlier: boolean
}

export type LiveTranscript = LiveTranscriptState & {
  loadEarlier: () => Promise<NativeChatOlderPageResult>
}

type Held = {
  feed: AgentSessionTranscriptFeed | null
  byId: Map<string, NativeChatMessage>
  start: number | null
  /** The newest page was read; a later watch only continues from it. */
  read: boolean
}

const UNREAD: LiveTranscriptState = {
  phase: 'loading',
  error: null,
  messages: [],
  readTo: null,
  hasMore: false,
  loadingEarlier: false
}

const offsetOf = (m: NativeChatMessage) => m.transcriptOffset ?? 0

function ordered(byId: Map<string, NativeChatMessage>): NativeChatMessage[] {
  return [...byId.values()].sort((a, b) => offsetOf(a) - offsetOf(b))
}

function unread(feed: AgentSessionTranscriptFeed | null): Held {
  return { feed, byId: new Map(), start: null, read: false }
}

/**
 * Holds what a chat source's transcript feed has read. Messages are keyed by id, so a page and a
 * delta that overlap merge instead of doubling. While `enabled` is false nothing is watched; the
 * feed catches up from where it stopped when it is watched again.
 */
export function useLiveTranscriptFeed(
  feed: AgentSessionTranscriptFeed | null,
  enabled = true
): LiveTranscript {
  const held = useRef<Held>(unread(null))
  const [state, setState] = useState(UNREAD)
  const [shown, setShown] = useState(feed)
  if (shown !== feed) {
    setShown(feed)
    setState(UNREAD)
  }

  // oxlint-disable-next-line react-doctor/effect-needs-cleanup -- cleanup stops the watch, including one started after the first page.
  useEffect(() => {
    if (!feed || !enabled) {
      return
    }
    if (held.current.feed !== feed) {
      held.current = unread(feed)
    }
    const mine = held.current
    let closed = false
    let stop: (() => void) | null = null
    const publish = (readTo: number, hasMore?: boolean) =>
      setState((s) => ({
        ...s,
        phase: 'ready',
        error: null,
        messages: ordered(mine.byId),
        readTo,
        hasMore: hasMore ?? s.hasMore
      }))
    const applyDelta = (delta: LiveTranscriptDelta) => {
      if (delta.reset) {
        mine.byId = new Map(delta.messages.map((m) => [m.id, m]))
        mine.start = delta.messages.length ? offsetOf(delta.messages[0]) : delta.cursor
        mine.read = true
        publish(delta.cursor, mine.start > 0)
        return
      }
      for (const m of delta.messages) {
        mine.byId.set(m.id, m)
      }
      publish(delta.cursor)
    }
    if (mine.read) {
      stop = feed.watch(applyDelta)
    } else {
      void feed.page().then(
        (page) => {
          if (closed) {
            return
          }
          for (const m of page.messages) {
            mine.byId.set(m.id, m)
          }
          mine.start = page.start
          mine.read = true
          publish(page.cursor, page.more)
          stop = feed.watch(applyDelta)
        },
        (error: unknown) => {
          if (!closed) {
            setState((s) => ({
              ...s,
              phase: 'error',
              error: error instanceof Error ? error.message : String(error)
            }))
          }
        }
      )
    }
    return () => {
      closed = true
      stop?.()
    }
  }, [feed, enabled])

  const loadEarlier = useCallback(async (): Promise<NativeChatOlderPageResult> => {
    const mine = held.current
    const before = mine.start
    if (!feed || mine.feed !== feed || before === null || before === 0) {
      return 'exhausted'
    }
    setState((s) => ({ ...s, loadingEarlier: true }))
    try {
      const page = await feed.page(before)
      if (held.current !== mine) {
        return 'failed'
      }
      for (const m of page.messages) {
        mine.byId.set(m.id, m)
      }
      mine.start = Math.min(before, page.start)
      setState((s) => ({
        ...s,
        messages: ordered(mine.byId),
        hasMore: page.more,
        loadingEarlier: false
      }))
      return page.messages.length ? 'applied' : 'exhausted'
    } catch {
      if (held.current === mine) {
        setState((s) => ({ ...s, loadingEarlier: false }))
      }
      return 'failed'
    }
  }, [feed])

  return useMemo(() => ({ ...state, loadEarlier }), [state, loadEarlier])
}

/** Streams one transcript by id straight from the registry: a session's, or one of its subagents'. */
export function useLiveTranscript(sessionId: string | null): LiveTranscript {
  const feed = useMemo(
    () => (sessionId && window.api?.liveSessions ? liveTranscriptFeed(sessionId) : null),
    [sessionId]
  )
  return useLiveTranscriptFeed(feed)
}
