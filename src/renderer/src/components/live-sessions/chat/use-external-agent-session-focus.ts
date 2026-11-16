import { useEffect, type RefObject } from 'react'
import type { NativeChatComposerHandle } from '../../native-chat/composer/native-chat-composer-types'
import { focusNativeChatPromptCard } from '../../native-chat/prompts/use-native-chat-prompt-card-focus'
import { useAgentSessionFocusRequest } from './agent-session-focus-requests'

// Requests are numbered app-wide and only the newest is kept: one that was acted on stays acted on
// when its chat is mounted again.
let handledFocusNonce = 0

/**
 * A menu asked this session's chat for its composer or its permission card. Acted on once, when
 * the chat is on screen; the frame around the chat serves the recap, subagents and tasks panels.
 */
export function useExternalAgentSessionFocus({
  sessionId,
  isVisible,
  rootRef,
  composerRef
}: {
  sessionId: string
  isVisible: boolean
  rootRef: RefObject<HTMLElement | null>
  composerRef: RefObject<NativeChatComposerHandle | null>
}): void {
  const request = useAgentSessionFocusRequest(sessionId)
  useEffect(() => {
    if (!request || !isVisible || request.nonce <= handledFocusNonce) {
      return
    }
    if (request.target !== 'composer' && request.target !== 'permission') {
      return
    }
    handledFocusNonce = request.nonce
    const target = request.target
    // A frame later: the frame around the chat first brings it back from under a subagent's
    // transcript. Never cancelled, since it only reads refs an unmounted chat has cleared.
    requestAnimationFrame(() => {
      if (target === 'composer') {
        composerRef.current?.focus()
        return
      }
      const root = rootRef.current
      const card = root?.querySelector<HTMLElement>('[data-native-chat-approval-card]')
      if (!root || !card) {
        return
      }
      card.scrollIntoView({ block: 'nearest' })
      // Its first option when it can be answered here; the card itself when it only shows the prompt.
      if (!focusNativeChatPromptCard(root, null)) {
        card.focus()
      }
    })
  }, [request, isVisible, rootRef, composerRef])
}
