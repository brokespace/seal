// @vitest-environment happy-dom
import { Activity, useImperativeHandle, type Ref } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LiveSessionChat, type LiveSessionChatProps } from './LiveSessionChat'
import { sampleLiveSession } from './live-session.test-fixture'

const jumps: string[] = []

vi.mock('../native-chat/NativeChatMessageList', () => ({
  NativeChatMessageList: ({ ref }: { ref: Ref<{ revealMessage: (id: string) => void }> }) => {
    useImperativeHandle(ref, () => ({ revealMessage: (id: string) => jumps.push(id) }))
    return null
  }
}))

afterEach(cleanup)

it('jumps to a message once, not again when the view comes back from behind a tab', () => {
  const props: LiveSessionChatProps = {
    session: sampleLiveSession('Fix the login bug'),
    transcript: {
      phase: 'ready',
      error: null,
      messages: [],
      hasMore: false,
      loadingEarlier: false,
      loadEarlier: async () => 'exhausted'
    },
    pending: [],
    onSend: () => {},
    onRetry: () => {},
    onAnswer: () => {},
    answering: null,
    reveal: { messageId: 'message-7', nonce: 1 }
  }
  const view = (mode: 'visible' | 'hidden', reveal = props.reveal): React.JSX.Element => (
    <Activity mode={mode}>
      <LiveSessionChat {...props} reveal={reveal} />
    </Activity>
  )
  const { rerender } = render(view('visible'))
  rerender(view('hidden'))
  rerender(view('visible'))
  expect(jumps).toEqual(['message-7'])

  rerender(view('visible', { messageId: 'message-7', nonce: 2 }))
  expect(jumps).toEqual(['message-7', 'message-7'])
})
