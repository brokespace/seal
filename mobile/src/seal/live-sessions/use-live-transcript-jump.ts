import { useEffect, useRef, type RefObject } from 'react'
import type { FlatList } from 'react-native'
import type { LiveTranscriptState } from './use-live-transcript'

/** A recap reaches back at most this far for a message the phone has not loaded. */
const MAX_EARLIER_PAGES = 12
/** A jump that has not landed by now is dropped, so a later page cannot move the reader unasked. */
const JUMP_PATIENCE_MS = 20_000

type Transcript = Pick<LiveTranscriptState, 'messages' | 'hasMore' | 'loadingEarlier'> & {
  loadEarlier: () => Promise<void>
}

type Target = { messageId: string; pages: number; until: number }

/**
 * Shows one message of a session's transcript at the top of the list, loading earlier pages until
 * it is there. Transcript messages lead the list's rows, so a message's place is its row.
 */
export function useLiveTranscriptJump<Row>({
  list,
  atBottom,
  transcript
}: {
  list: RefObject<FlatList<Row> | null>
  atBottom: RefObject<boolean>
  transcript: Transcript
}): {
  jumpTo: (messageId: string) => void
  onScrollToIndexFailed: (info: { index: number; averageItemLength: number }) => void
} {
  const target = useRef<Target | null>(null)
  const { messages, hasMore, loadingEarlier, loadEarlier } = transcript

  const step = () => {
    const wanted = target.current
    if (!wanted) {
      return
    }
    if (Date.now() > wanted.until) {
      target.current = null
      return
    }
    const index = messages.findIndex((message) => message.id === wanted.messageId)
    if (index !== -1) {
      target.current = null
      // Why: a reader sent to an older message must not be pulled back down by the next delta.
      atBottom.current = false
      list.current?.scrollToIndex({ index, animated: false, viewPosition: 0 })
      return
    }
    if (loadingEarlier) {
      return
    }
    if (!hasMore || wanted.pages >= MAX_EARLIER_PAGES) {
      target.current = null
      return
    }
    wanted.pages += 1
    void loadEarlier()
  }

  // Each page that arrives is another chance to land, or the cue to ask for the next one.
  useEffect(step, [messages, hasMore, loadingEarlier])

  const jumpTo = (messageId: string) => {
    target.current = { messageId, pages: 0, until: Date.now() + JUMP_PATIENCE_MS }
    step()
  }

  // Rows are measured as they draw: land near the row, and the retry can then place it exactly.
  const onScrollToIndexFailed = (info: { index: number; averageItemLength: number }) => {
    list.current?.scrollToOffset({
      offset: Math.max(0, info.averageItemLength * info.index),
      animated: false
    })
    requestAnimationFrame(() =>
      list.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0 })
    )
  }

  return { jumpTo, onScrollToIndexFailed }
}
