import { useCallback, useRef } from 'react'
import type { NativeChatMessageListHandle } from '../../native-chat/messages/actions/use-native-chat-reveal-latest'
import { NativeChatMessageRevealContext } from '../../native-chat/messages/actions/use-native-chat-reveal-latest'
import { AgentSessionChatFrame, type AgentSessionFrameLookup } from './AgentSessionChatFrame'

/**
 * The slot of the chat view that every session's chat sits in: the session frame around it, with
 * the frame's jump to a message reaching the chat's own transcript.
 */
export function AgentSessionChatFrameSlot({
  lookup,
  isVisible,
  children
}: {
  lookup: AgentSessionFrameLookup
  isVisible: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const transcriptRef = useRef<Pick<NativeChatMessageListHandle, 'revealMessage'>>(null)
  const onRevealMessage = useCallback(
    (messageId: string) => transcriptRef.current?.revealMessage(messageId),
    []
  )
  return (
    <AgentSessionChatFrame lookup={lookup} isVisible={isVisible} onRevealMessage={onRevealMessage}>
      <NativeChatMessageRevealContext value={transcriptRef}>
        {children}
      </NativeChatMessageRevealContext>
    </AgentSessionChatFrame>
  )
}
