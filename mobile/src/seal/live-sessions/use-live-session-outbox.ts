import { useCallback, useState } from 'react'
import { randomV4Uuid } from '../../platform/random-v4-uuid'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { retryLiveMessage, sendLiveMessage } from './live-session-operations'
import { pendingLiveMessages } from './live-session-pending-rows'
import type { LiveMessage, LiveTranscriptMessage } from './live-session-schemas'
import { currentLiveSessionId, type LiveSessionsFeedState } from './live-sessions-feed'

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * One session's messages on their way: the host's outbox plus sends it hasn't acknowledged (or never
 * received), minus those the transcript already shows.
 */
export function useLiveSessionOutbox({
  client,
  feed,
  sessionId,
  transcript,
  onSend
}: {
  client: RpcClient | null
  feed: LiveSessionsFeedState & { upsertMessage: (message: LiveMessage) => void }
  sessionId: string
  transcript: readonly LiveTranscriptMessage[]
  onSend: () => void
}) {
  const { upsertMessage, messages: outboxById } = feed
  const [unacked, setUnacked] = useState<LiveMessage[]>([])

  const pending = pendingLiveMessages(transcript, [
    ...[...outboxById.values()].filter(
      (message) => currentLiveSessionId(feed, message.sessionId) === sessionId
    ),
    ...unacked.filter((message) => !outboxById.has(message.messageId))
  ])

  const deliver = useCallback(
    async (message: LiveMessage) => {
      if (!client) {
        return
      }
      setUnacked((list) => [
        ...list.filter((m) => m.messageId !== message.messageId),
        { ...message, state: 'sending', error: null }
      ])
      onSend()
      try {
        upsertMessage(
          await sendLiveMessage(client, {
            sessionId: message.sessionId,
            messageId: message.messageId,
            text: message.text
          })
        )
        setUnacked((list) => list.filter((m) => m.messageId !== message.messageId))
      } catch (error) {
        setUnacked((list) =>
          list.map((m) =>
            m.messageId === message.messageId
              ? { ...m, state: 'failed', error: errorText(error) }
              : m
          )
        )
      }
    },
    [client, onSend, upsertMessage]
  )

  const send = useCallback(
    (text: string) => {
      const now = Date.now()
      void deliver({
        messageId: randomV4Uuid(),
        sessionId,
        text,
        state: 'sending',
        route: null,
        error: null,
        createdAt: now,
        updatedAt: now
      })
    },
    [deliver, sessionId]
  )

  const retry = useCallback(
    async (message: LiveMessage) => {
      if (!client) {
        return
      }
      // Never reached the host: send it again under the same id.
      if (!outboxById.has(message.messageId)) {
        await deliver(message)
        return
      }
      try {
        const next = await retryLiveMessage(client, message.messageId)
        if (next) {
          upsertMessage(next)
        }
      } catch (error) {
        upsertMessage({ ...message, error: errorText(error) })
      }
    },
    [client, deliver, outboxById, upsertMessage]
  )

  return { pending, send, retry }
}
