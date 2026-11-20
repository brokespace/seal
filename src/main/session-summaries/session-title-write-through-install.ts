import type { LiveSessionRegistryEvent } from '../../shared/live-sessions/live-session-types'
import type { LiveSessionService } from '../live-sessions/live-session-service'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { SavedOwedChatNames } from './owed-chat-names'
import { SessionTitleWriteThrough } from './session-title-write-through'
import { followStructuredChatNames } from './structured-chat-name-feed'
import { unrefTimer } from './unref-timer'

/** Session titles on this host, written through to the chats and terminal tabs that own them. */
export function createSessionTitleWriteThrough(options: {
  liveSessions: Pick<LiveSessionService, 'annotate' | 'subscribe' | 'snapshot'>
  /** The pane's worktree and tab, to rename its terminal tab. */
  renameCliTab: (paneKey: string, title: string | null) => void
  /** The file of row names their chats have not taken; without one they last for this run only. */
  owedNamesPath?: string
  log?: (message: string, error?: unknown) => void
}): { dispose: () => void } {
  const { liveSessions, log } = options
  const owed = options.owedNamesPath ? new SavedOwedChatNames(options.owedNamesPath, log) : null
  let chatNames: ReturnType<typeof followStructuredChatNames> | null = null
  const titles = new SessionTitleWriteThrough({
    chatName: (chatSessionId) => {
      const record = getStructuredAgentSessionHost()?.deps.store.getRecord(chatSessionId)
      return record
        ? {
            name: record.conversationName ?? null,
            user: record.conversationNameSource === 'user'
          }
        : null
    },
    renameChat: async (chatSessionId, name) => {
      const host = getStructuredAgentSessionHost()
      return (await host?.setUserConversationName(chatSessionId, name, 'rename'))?.applied === true
    },
    subscribeChatNames: (listener) => {
      chatNames = followStructuredChatNames(listener, log)
      return chatNames.stop
    },
    renameCliTab: options.renameCliTab,
    annotate: (sessionId, customTitle) =>
      void liveSessions
        .annotate({ sessionId, customTitle })
        .catch((error: unknown) => log?.('[session-titles] saving a session title failed', error)),
    setTimer: unrefTimer,
    owed: owed ?? undefined,
    log
  })
  const observe = (event: LiveSessionRegistryEvent): void => {
    // The structured host is installed and replaced without notice; every registry event checks.
    chatNames?.follow()
    titles.observe(event)
  }
  let release: (() => void) | null = null
  let disposed = false
  const start = (): void => {
    if (disposed) {
      return
    }
    observe({ type: 'snapshot', snapshot: liveSessions.snapshot() })
    release = liveSessions.subscribe(observe)
  }
  if (owed) {
    // No row is met before the owed names are read: one of them may be the newer name.
    void owed.load().then(start)
  } else {
    start()
  }
  return {
    dispose: () => {
      disposed = true
      release?.()
      titles.dispose()
    }
  }
}
