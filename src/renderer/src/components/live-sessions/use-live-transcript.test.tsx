// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { LiveTranscriptDelta } from '../../../../shared/live-sessions/live-session-types'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import type { AgentSessionTranscriptFeed } from './chat/live-transcript-feed'
import { useLiveTranscriptFeed } from './use-live-transcript'

afterEach(cleanup)

function row(offset: number): NativeChatMessage {
  return {
    id: `o${offset}`,
    role: 'assistant',
    source: 'transcript',
    timestamp: 1,
    transcriptOffset: offset,
    blocks: [{ type: 'text', text: 'Done.' }]
  }
}

it('keeps the rows a reader scrolled up to when a newest page replaces them, until the reader is back', async () => {
  let deliver: (delta: LiveTranscriptDelta) => void = () => {}
  const feed: AgentSessionTranscriptFeed = {
    page: async () => ({
      sessionId: 's',
      messages: [row(100), row(200)],
      cursor: 300,
      start: 100,
      more: true
    }),
    watch: (onDelta) => {
      deliver = onDelta
      return () => {}
    }
  }
  const { result } = renderHook(() => useLiveTranscriptFeed(feed))
  const shown = () => result.current.messages.map((message) => message.id)
  await waitFor(() => expect(shown()).toEqual(['o100', 'o200']))

  let readerIsBack = () => {}
  act(() => {
    readerIsBack = result.current.retainHistory()
  })
  act(() => {
    deliver({ sessionId: 's', from: 300, cursor: 9000, messages: [row(8000)], reset: true })
    deliver({ sessionId: 's', from: 9000, cursor: 9500, messages: [row(9000)] })
  })
  expect(shown()).toEqual(['o100', 'o200'])
  expect(result.current.readTo).toBe(300)

  act(() => readerIsBack())
  expect(shown()).toEqual(['o8000', 'o9000'])
  expect(result.current.readTo).toBe(9500)
})
