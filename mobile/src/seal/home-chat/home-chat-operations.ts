import * as z from 'zod'
import type {
  HomeChatBackendKind,
  HomeChatSummary
} from '../../../../src/shared/home-chat/home-chat-types'
import type { PhoneDownloadTicket } from '../../../../src/shared/rpc-contract/phone-transfer-params'
import { salvagingArray } from '../../../../src/shared/zod-salvage'
import { defineRpcOperation, runRpcOperation } from '../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../transport/rpc/rpc-operation-result-reader'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import type { UnvalidatedRpcRequestPort } from '../../transport/rpc/unvalidated-rpc-request-port'
import {
  homeChatAccountOptionSchema,
  homeChatSchema,
  homeChatSummaryListSchema,
  homeChatSummarySchema,
  homeChatWatchFrameSchema,
  type HomeChatWatchFrame
} from './home-chat-schemas'

const okReply = z.object({ ok: z.literal(true) }).loose()

const listChats = defineRpcOperation({
  name: 'home-chat.list',
  method: 'homeChat.list',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('chats', z.object({ chats: homeChatSummaryListSchema }))
})

const getChat = defineRpcOperation({
  name: 'home-chat.get',
  method: 'homeChat.get',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('chat', z.object({ chat: homeChatSchema.nullable() }))
})

const createChat = defineRpcOperation({
  name: 'home-chat.create',
  method: 'homeChat.create',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('created', z.object({ chat: homeChatSchema }))
})

const updateChat = defineRpcOperation({
  name: 'home-chat.update',
  method: 'homeChat.update',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('updated', z.object({ chat: homeChatSummarySchema }))
})

const deleteChat = defineRpcOperation({
  name: 'home-chat.delete',
  method: 'homeChat.delete',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('deleted', okReply)
})

const sendMessage = defineRpcOperation({
  name: 'home-chat.send',
  method: 'homeChat.send',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('sent', okReply)
})

const stopChat = defineRpcOperation({
  name: 'home-chat.stop',
  method: 'homeChat.stop',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('stopped', okReply)
})

const respondApproval = defineRpcOperation({
  name: 'home-chat.respond-approval',
  method: 'homeChat.respondApproval',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('responded', z.object({ handled: z.boolean() }))
})

const listAccounts = defineRpcOperation({
  name: 'home-chat.list-accounts',
  method: 'homeChat.listAccounts',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant(
    'accounts',
    z.object({ accounts: salvagingArray(homeChatAccountOptionSchema) })
  )
})

const readAttachment = defineRpcOperation({
  name: 'home-chat.read-attachment',
  method: 'homeChat.readAttachment',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('attachment', z.object({ mimeType: z.string(), base64: z.string() }))
})

const openAttachmentDownload = defineRpcOperation({
  name: 'home-chat.open-attachment-download',
  method: 'homeChat.openAttachmentDownload',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant(
    'download-ticket',
    z.object({
      downloadId: z.string().min(1),
      fileName: z.string(),
      size: z.number(),
      mimeType: z.string(),
      chunkBytes: z.number()
    }) satisfies z.ZodType<PhoneDownloadTicket>
  )
})

const attachUpload = defineRpcOperation({
  name: 'home-chat.attach-upload',
  method: 'homeChat.attachUpload',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant(
    'attached',
    z.object({ path: z.string().min(1), name: z.string(), size: z.number() })
  )
})

const unwatch = defineRpcOperation({
  name: 'home-chat.unwatch',
  method: 'homeChat.unwatch',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant('unwatched', z.object({}).loose())
})

type Port = UnvalidatedRpcRequestPort

export async function fetchHomeChats(client: Port): Promise<HomeChatSummary[]> {
  return (await runRpcOperation(client, listChats, null)).chats
}

export async function fetchHomeChat(client: Port, chatId: string) {
  return (await runRpcOperation(client, getChat, { chatId })).chat
}

export async function createHomeChat(
  client: Port,
  args: { backend: HomeChatBackendKind; accountId: string | null }
) {
  return (await runRpcOperation(client, createChat, args)).chat
}

export async function renameHomeChat(client: Port, chatId: string, title: string) {
  return (await runRpcOperation(client, updateChat, { chatId, title })).chat
}

export async function deleteHomeChat(client: Port, chatId: string): Promise<void> {
  await runRpcOperation(client, deleteChat, { chatId })
}

export async function sendHomeChatMessage(client: Port, chatId: string, text: string) {
  await runRpcOperation(client, sendMessage, { chatId, text })
}

export async function stopHomeChat(client: Port, chatId: string): Promise<void> {
  await runRpcOperation(client, stopChat, { chatId })
}

export async function respondHomeChatApproval(
  client: Port,
  args: { chatId: string; entryId: string; approved: boolean }
): Promise<boolean> {
  return (await runRpcOperation(client, respondApproval, args)).handled
}

export async function fetchHomeChatAccounts(client: Port) {
  return (await runRpcOperation(client, listAccounts, null)).accounts
}

export async function readHomeChatAttachment(client: Port, chatId: string, attachmentId: string) {
  return runRpcOperation(client, readAttachment, { chatId, attachmentId })
}

export async function openHomeChatAttachmentDownload(
  client: Port,
  chatId: string,
  attachmentId: string
): Promise<PhoneDownloadTicket> {
  return runRpcOperation(client, openAttachmentDownload, { chatId, attachmentId })
}

export async function attachHomeChatUpload(client: Port, chatId: string, uploadId: string) {
  return runRpcOperation(client, attachUpload, { chatId, uploadId })
}

/**
 * Opens `homeChat.watch`. The host only names the subscription in its `ready` frame, so closing
 * before that frame waits for it and then unwatches, leaving nothing registered on the host.
 */
export function watchHomeChats(
  client: RpcClient,
  onFrame: (frame: Exclude<HomeChatWatchFrame, { type: 'error' }>) => void,
  onFailure: () => void
): () => void {
  let subscriptionId: string | null = null
  let closed = false
  let closeStream: (() => void) | null = null
  const release = () => {
    closeStream?.()
    if (subscriptionId) {
      void runRpcOperation(client, unwatch, { subscriptionId }).catch(() => {})
    }
  }
  closeStream = client.subscribe('homeChat.watch', null, (raw) => {
    const parsed = homeChatWatchFrameSchema.safeParse(raw)
    if (!parsed.success) {
      return
    }
    const frame = parsed.data
    if (frame.type === 'ready') {
      subscriptionId = frame.subscriptionId
    }
    if (closed) {
      if (frame.type !== 'event') {
        release()
      }
      return
    }
    if (frame.type === 'error') {
      onFailure()
      return
    }
    onFrame(frame)
  })
  return () => {
    if (closed) {
      return
    }
    closed = true
    if (subscriptionId) {
      release()
    }
  }
}
