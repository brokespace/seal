import {
  LiveSessionAnswerParams,
  LiveSessionHostRunParams,
  LiveSessionTakeOverParams,
  LiveSessionAnnotateParams,
  LiveSessionRemoveParams,
  LiveSessionMessagesParams,
  LiveSessionRetryParams,
  LiveSessionSendParams,
  LiveSessionTranscriptImageParams,
  LiveSessionTranscriptParams,
  LiveSessionTranscriptSinceParams,
  LiveSessionUnwatchParams,
  LiveSessionWatchTranscriptParams
} from '../../../../../shared/live-sessions/live-session-rpc-params'
import {
  liveSessionEventForClient,
  liveSessionSnapshotForClient
} from '../../../../../shared/live-sessions/live-session-status-compat'
import { getLiveSessionService } from '../../../../live-sessions/live-session-service-instance'
import type { LiveSessionService } from '../../../../live-sessions/live-session-service'
import { defineMethod, defineStreamingMethod } from '../../core'
import { holdSubscription } from '../rpc-subscription-hold'
import { runLiveSessionHostScript } from '../../../../live-sessions/hosts/live-session-host-run'
import { withInlineImages } from '../../../../live-sessions/transcripts/transcript-inline-images'
import type { NativeChatMessage } from '../../../../../shared/native-chat/native-chat-types'

function service(): LiveSessionService {
  const found = getLiveSessionService()
  if (!found) {
    throw new Error('Live sessions are not available on this host')
  }
  return found
}

/** What a client that did not ask for image references is sent: its inline images as data URLs. */
async function forClient<T extends { messages: NativeChatMessage[] }>(
  sessionId: string,
  images: 'refs' | undefined,
  held: T
): Promise<T> {
  return images === 'refs'
    ? held
    : {
        ...held,
        messages: await withInlineImages(held.messages, (start, length) =>
          service().transcriptImageBase64(sessionId, start, length)
        )
      }
}

export const LIVE_SESSION_METHODS = [
  defineMethod({
    name: 'liveSessions.list',
    permission: 'workspace',
    params: null,
    handler: (_params, ctx) =>
      liveSessionSnapshotForClient(service().snapshot(), ctx.clientCapabilities)
  }),
  // Snapshot first, then registry events and outbox message changes, each in emit order.
  defineStreamingMethod({
    name: 'liveSessions.watch',
    permission: 'workspace',
    params: null,
    handler: async (_params, ctx, emit) => {
      const live = service()
      await holdSubscription('live-sessions', ctx, emit, (subscriptionId) => {
        const offEvents = live.subscribe((event) =>
          emit({ type: 'event', event: liveSessionEventForClient(event, ctx.clientCapabilities) })
        )
        const offMessages = live.subscribeMessages((message) => emit({ type: 'message', message }))
        emit({
          type: 'ready',
          subscriptionId,
          // A desktop lists this machine from this feed only when it carries chats; else it scans.
          ...(process.env.SEAL_LIVE_SESSION_FEDERATION === 'off'
            ? {}
            : { surfaces: ['chat', 'cli', 'external'] }),
          snapshot: liveSessionSnapshotForClient(live.snapshot(), ctx.clientCapabilities),
          messages: live.messages()
        })
        return () => {
          offEvents()
          offMessages()
        }
      })
    }
  }),
  defineMethod({
    name: 'liveSessions.transcript',
    permission: 'workspace',
    params: LiveSessionTranscriptParams,
    handler: async ({ sessionId, before, limit, images }) =>
      forClient(sessionId, images, await service().transcriptPage(sessionId, before ?? null, limit))
  }),
  // What a paired desktop's recap of a chat here reads: the rows after a cursor it already holds.
  defineMethod({
    name: 'liveSessions.transcriptSince',
    permission: 'workspace',
    params: LiveSessionTranscriptSinceParams,
    handler: async ({ sessionId, cursor, images }) =>
      forClient(sessionId, images, await service().transcriptSince(sessionId, cursor))
  }),
  // One piece of an inline image's base64, as a row's reference names it.
  defineMethod({
    name: 'liveSessions.transcriptImage',
    permission: 'workspace',
    params: LiveSessionTranscriptImageParams,
    handler: async ({ sessionId, start, length }) => ({
      base64: await service().transcriptImageBase64(sessionId, start, length)
    })
  }),
  // Resumable: pass the last delta's cursor as fromCursor after a reconnect.
  defineStreamingMethod({
    name: 'liveSessions.watchTranscript',
    permission: 'workspace',
    params: LiveSessionWatchTranscriptParams,
    handler: async ({ sessionId, fromCursor, images }, ctx, emit) => {
      const live = service()
      await holdSubscription('live-transcript', ctx, emit, (subscriptionId) => {
        // Frames leave in the order the transcript gave them, whatever each one's images take to read.
        let sent: Promise<unknown> = Promise.resolve()
        const send = (frame: () => Promise<unknown>): void => {
          sent = sent
            .then(frame)
            .then(emit)
            .catch(() => undefined)
        }
        const subscription = live.watchTranscript(sessionId, fromCursor ?? null, (delta) =>
          send(async () => ({ type: 'delta', delta: await forClient(sessionId, images, delta) }))
        )
        void subscription.ready.then((page) =>
          send(async () => ({
            type: 'ready',
            subscriptionId,
            page: page && (await forClient(sessionId, images, page))
          }))
        )
        return subscription.unsubscribe
      })
    }
  }),
  defineMethod({
    name: 'liveSessions.unwatch',
    permission: 'workspace',
    params: LiveSessionUnwatchParams,
    handler: ({ subscriptionId }, { runtime }) => {
      runtime.cleanupSubscription(subscriptionId)
      return { unsubscribed: true }
    }
  }),
  defineMethod({
    name: 'liveSessions.send',
    permission: 'workspace',
    params: LiveSessionSendParams,
    handler: (request) => service().send(request)
  }),
  defineMethod({
    name: 'liveSessions.retry',
    permission: 'workspace',
    params: LiveSessionRetryParams,
    handler: (request) => service().retry(request)
  }),
  defineMethod({
    name: 'liveSessions.messages',
    permission: 'workspace',
    params: LiveSessionMessagesParams,
    handler: ({ sessionId }) => service().messages(sessionId)
  }),
  defineMethod({
    name: 'liveSessions.answer',
    permission: 'workspace',
    params: LiveSessionAnswerParams,
    handler: (answer) => service().answer(answer)
  }),
  // A paired desktop's live-sessions registry scans, types into and answers agents on this machine through this.
  // 'workspace' already allows running commands here as this user (terminals), so a script adds no reach.
  defineMethod({
    name: 'liveSessions.hostRun',
    permission: 'workspace',
    params: LiveSessionHostRunParams,
    handler: (params) => runLiveSessionHostScript(params)
  }),
  defineMethod({
    name: 'liveSessions.takeOver',
    permission: 'workspace',
    params: LiveSessionTakeOverParams,
    handler: ({ sessionId }) => service().takeOver(sessionId)
  }),
  defineMethod({
    name: 'liveSessions.remove',
    permission: 'workspace',
    params: LiveSessionRemoveParams,
    handler: (request) => service().remove(request)
  }),
  defineMethod({
    name: 'liveSessions.annotate',
    permission: 'workspace',
    params: LiveSessionAnnotateParams,
    handler: (annotation) => service().annotate(annotation)
  })
]
