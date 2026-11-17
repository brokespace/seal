import { useCallback, useRef, useState } from 'react'
import { defineFixture } from '../../component-fixtures/component-fixture'
import { SAMPLE_NOW, sampleLiveSession } from '../live-sessions/live-session.test-fixture'
import { AgentSessionChatFrameView } from '../live-sessions/chat/AgentSessionChatFrame'
import { externalAgentSessionChatRows } from '../live-sessions/chat/external-agent-session-chat-rows'
import { NativeChatMessageList } from '../native-chat/NativeChatMessageList'
import type { NativeChatMessageListHandle } from '../native-chat/messages/actions/use-native-chat-reveal-latest'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import {
  SAMPLE_RECAP_BRIEF,
  sampleRecapView,
  sampleSessionRecap
} from './session-recap.test-fixture'

const MIN = 60_000
const TURNS = 40
const PAGE = 12
const TARGET = 'o400'

// A long conversation, of which only the end is loaded: the target sits three pages back.
const HISTORY: NativeChatMessage[] = Array.from({ length: TURNS * 2 }, (_, index) => {
  const user = index % 2 === 0
  const turn = Math.floor(index / 2) + 1
  const id = `o${index * 100}`
  return {
    id,
    role: user ? 'user' : 'assistant',
    source: 'transcript',
    timestamp: SAMPLE_NOW - (TURNS * 2 - index) * 20 * MIN,
    transcriptOffset: index * 100,
    blocks: [
      {
        type: 'text',
        text:
          id === TARGET
            ? 'Find out why some customers were charged twice last week.'
            : user
              ? `Request ${turn}: tighten the next part of the webhook handling.`
              : `Reply ${turn}: done. The handler now checks the event id before it charges, and the tests for that path pass.\n\nNext I will look at the retry window.`
      }
    ]
  }
})

const VIEW = sampleRecapView({
  recap: sampleSessionRecap({
    asked: [
      {
        id: 'a1',
        text: 'Find out why some customers were charged twice last week',
        messageId: TARGET,
        at: SAMPLE_NOW - 26 * 60 * MIN
      }
    ]
  })
})

const SESSION = sampleLiveSession('billing', {
  title: 'why were some customers charged twice last week',
  cwd: '/code/billing',
  project: 'billing',
  recap: SAMPLE_RECAP_BRIEF
})

function PagedPane(): React.JSX.Element {
  const [loaded, setLoaded] = useState(PAGE)
  const listRef = useRef<NativeChatMessageListHandle>(null)
  const loadEarlier = useCallback(async () => {
    if (loaded >= HISTORY.length) {
      return 'exhausted' as const
    }
    setLoaded((count) => Math.min(HISTORY.length, count + PAGE))
    return 'applied' as const
  }, [loaded])
  return (
    <div className="flex h-[640px]">
      <AgentSessionChatFrameView
        session={SESSION}
        isVisible
        onRevealMessage={(messageId) => listRef.current?.revealMessage(messageId)}
        recap={{ view: VIEW, refreshing: false, failed: null, refresh: () => {}, mark: () => {} }}
      >
        <NativeChatMessageList
          ref={listRef}
          session={externalAgentSessionChatRows({
            agent: SESSION.provider,
            providerSessionId: SESSION.providerSessionId,
            transcript: {
              phase: 'ready',
              error: null,
              messages: HISTORY.slice(HISTORY.length - loaded),
              readTo: null,
              hasMore: loaded < HISTORY.length,
              loadingEarlier: false,
              loadEarlier
            },
            pending: [],
            working: false
          })}
          isVisible
          isWorking={false}
          expandSignal={false}
        />
      </AgentSessionChatFrameView>
    </div>
  )
}

/** Pressing a recap item whose message is not loaded yet pages back to it and brings it into view. */
export const toEarlierMessage = defineFixture({
  width: 1100,
  render: () => <PagedPane />,
  interact: async (frame) => {
    frame.querySelector<HTMLButtonElement>('[data-live-session-panel-toggle="recap"]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    frame.querySelector<HTMLButtonElement>(`[data-recap-jump="${TARGET}"]`)?.click()
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
})
