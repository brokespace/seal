import { useCallback, useMemo, useState } from 'react'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import type { MobileNativeChatUrlImageSource } from '../../session/native-chat/visual/mobile-native-chat-image-preview'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { answerLivePermission } from './live-session-operations'
import { canTakeOverLiveSession, liveSessionAcceptsInput } from './live-session-presentation'
import type { LiveMessage, LiveSession } from './live-session-schemas'
import { currentLiveSessionId, type LiveSessionsFeedState } from './live-sessions-feed'
import { liveTranscriptImageSource } from './live-transcript-image-source'
import { useLiveSessionOutbox } from './use-live-session-outbox'
import { useLiveTranscript } from './use-live-transcript'

type Feed = LiveSessionsFeedState & { upsertMessage: (message: LiveMessage) => void }

/**
 * What the chat view needs from a session the registry holds and no workspace tab hosts: the phone's
 * `AgentSessionChatSource`, over the `liveSessions.*` calls, as state a screen can draw.
 */
export type LiveSessionChatSource = {
  /** The record's id now: a fresh agent's changes when its first prompt names it. */
  sessionId: string
  /** Null before the list is read, and once the session has left it. */
  session: LiveSession | null
  messages: ReturnType<typeof useLiveTranscript>
  /** Reads the images the transcript holds inline, which its rows name by reference. */
  images: MobileNativeChatUrlImageSource | undefined
  /** The outbox: messages on their way, oldest first, and the ones that did not arrive. */
  pending: { list: LiveMessage[]; retry: (message: LiveMessage) => Promise<void> }
  prompt: NonNullable<LiveSession['permission']> | null
  /** False when the session did not take the answer; `answerError` then says why. */
  answer: (optionId: string) => Promise<boolean>
  answerError: string | null
  clearAnswerError: () => void
  composer: { send: (text: string) => void }
  /** `answer`: the host can deliver one of the prompt's options. */
  capabilities: { send: boolean; answer: boolean; takeOver: boolean }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function useLiveSessionChatSource({
  client,
  feed,
  sessionId: routeSessionId
}: {
  client: RpcClient | null
  feed: Feed
  /** The id the screen was opened with. */
  sessionId: string
}): LiveSessionChatSource {
  const t = useMobileTranslation()
  const sessionId = currentLiveSessionId(feed, routeSessionId)
  const session = feed.sessions.find((entry) => entry.id === sessionId) ?? null
  const messages = useLiveTranscript(client, sessionId, session !== null)
  const images = useMemo(
    () => (client ? liveTranscriptImageSource(client, sessionId) : undefined),
    [client, sessionId]
  )
  const outbox = useLiveSessionOutbox({
    client,
    feed,
    sessionId,
    transcript: messages.messages,
    readTo: messages.readTo
  })
  const [answerError, setAnswerError] = useState<string | null>(null)
  const clearAnswerError = useCallback(() => setAnswerError(null), [])

  const promptId = session?.permission?.promptId
  const answer = useCallback(
    async (optionId: string): Promise<boolean> => {
      if (!client || !promptId) {
        return false
      }
      setAnswerError(null)
      try {
        const result = await answerLivePermission(client, { sessionId, promptId, optionId })
        if (!result.ok) {
          setAnswerError(
            result.error ??
              t('seal.liveSessions.answerFailed', 'The session didn’t take that answer.')
          )
        }
        return result.ok
      } catch (error) {
        setAnswerError(errorText(error))
        return false
      }
    },
    [client, promptId, sessionId, t]
  )

  return {
    sessionId,
    session,
    messages,
    images,
    pending: { list: outbox.pending.map((pending) => pending.message), retry: outbox.retry },
    prompt: session?.permission ?? null,
    answer,
    answerError,
    clearAnswerError,
    composer: { send: outbox.send },
    capabilities: {
      send: session !== null && liveSessionAcceptsInput(session),
      // A host from before capabilities answers by option.
      answer: session?.capabilities?.answer !== 'none',
      takeOver: session !== null && session.alive && canTakeOverLiveSession(session)
    }
  }
}
