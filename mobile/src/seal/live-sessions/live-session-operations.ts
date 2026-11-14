import * as z from 'zod'
import { salvagingArray } from '../../../../src/shared/zod-salvage'
import { defineRpcOperation, runRpcOperation } from '../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../transport/rpc/rpc-operation-result-reader'
import type { UnvalidatedRpcRequestPort } from '../../transport/rpc/unvalidated-rpc-request-port'
import {
  liveMessageSchema,
  livePermissionAnswerResultSchema,
  liveSessionSnapshotSchema,
  liveTakeOverResultSchema,
  liveTranscriptPageSchema,
  type LiveMessage,
  type LiveSessionSnapshot,
  type LiveTakeOverResult,
  type LiveTranscriptPage
} from './live-session-schemas'

const listSessions = defineRpcOperation({
  name: 'live-sessions.list',
  method: 'liveSessions.list',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('snapshot', liveSessionSnapshotSchema)
})

const listMessages = defineRpcOperation({
  name: 'live-sessions.messages',
  method: 'liveSessions.messages',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('messages', salvagingArray(liveMessageSchema))
})

const transcriptPage = defineRpcOperation({
  name: 'live-sessions.transcript',
  method: 'liveSessions.transcript',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('page', liveTranscriptPageSchema)
})

const sendMessage = defineRpcOperation({
  name: 'live-sessions.send',
  method: 'liveSessions.send',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('message', liveMessageSchema)
})

const retryMessage = defineRpcOperation({
  name: 'live-sessions.retry',
  method: 'liveSessions.retry',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('message', liveMessageSchema.nullable())
})

const answerPrompt = defineRpcOperation({
  name: 'live-sessions.answer',
  method: 'liveSessions.answer',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('answer', livePermissionAnswerResultSchema)
})

const takeOverSession = defineRpcOperation({
  name: 'live-sessions.take-over',
  method: 'liveSessions.takeOver',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('take-over', liveTakeOverResultSchema)
})

type Port = UnvalidatedRpcRequestPort

export function readLiveSessions(client: Port): Promise<LiveSessionSnapshot> {
  return runRpcOperation(client, listSessions, null)
}

export function readLiveMessages(client: Port): Promise<LiveMessage[]> {
  return runRpcOperation(client, listMessages, {})
}

export function readLiveTranscriptPage(
  client: Port,
  sessionId: string,
  before: number
): Promise<LiveTranscriptPage> {
  return runRpcOperation(client, transcriptPage, { sessionId, before })
}

export function sendLiveMessage(
  client: Port,
  request: { sessionId: string; messageId: string; text: string }
): Promise<LiveMessage> {
  return runRpcOperation(client, sendMessage, request)
}

export function retryLiveMessage(client: Port, messageId: string): Promise<LiveMessage | null> {
  return runRpcOperation(client, retryMessage, { messageId })
}

export function answerLivePermission(
  client: Port,
  answer: { sessionId: string; promptId: string; optionId: string }
): Promise<z.output<typeof livePermissionAnswerResultSchema>> {
  return runRpcOperation(client, answerPrompt, answer)
}

export function takeOverLiveSession(client: Port, sessionId: string): Promise<LiveTakeOverResult> {
  return runRpcOperation(client, takeOverSession, { sessionId })
}
