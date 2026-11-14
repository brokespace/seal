import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { FlatList } from 'react-native'
import type { LiveTranscriptState } from './use-live-transcript'

/** A recap reaches back at most this far for a message the phone has not loaded. */
const MAX_EARLIER_PAGES = 12

type Transcript = Pick<LiveTranscriptState, 'messages' | 'hasMore' | 'loadingEarlier'> & {
  loadEarlier: () => Promise<void>
}

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
  const [target, setTarget] = useState<{ messageId: string; pages: number } | null>(null)
  const { messages, hasMore, loadingEarlier, loadEarlier } = transcript

  useEffect(() => {
    if (!target) {
      return
    }
    const index = messages.findIndex((message) => message.id === target.messageId)
    if (index !== -1) {
      // Why: a reader sent to an older message must not be pulled back down by the next delta.
      atBottom.current = false
      list.current?.scrollToIndex({ index, animated: false, viewPosition: 0 })
      setTarget(null)
      return
    }
    if (loadingEarlier) {
      return
    }
    if (!hasMore || target.pages >= MAX_EARLIER_PAGES) {
      setTarget(null)
      return
    }
    setTarget({ messageId: target.messageId, pages: target.pages + 1 })
    void loadEarlier()
  }, [target, messages, hasMore, loadingEarlier, loadEarlier, list, atBottom])

  const jumpTo = useCallback((messageId: string) => setTarget({ messageId, pages: 0 }), [])

  // Rows are measured as they draw: land near the row, and the retry can then place it exactly.
  const onScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      list.current?.scrollToOffset({
        offset: Math.max(0, info.averageItemLength * info.index),
        animated: false
      })
      requestAnimationFrame(() =>
        list.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0 })
      )
    },
    [list]
  )

  return { jumpTo, onScrollToIndexFailed }
}
