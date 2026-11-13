import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { defineMethod, defineStreamingMethod } from '../../core'
import {
  HomeChatAttachmentParams,
  HomeChatAttachUploadParams,
  HomeChatCreateParams,
  HomeChatIdParams,
  HomeChatRespondApprovalParams,
  HomeChatSendParams,
  HomeChatUnwatchParams,
  HomeChatUpdateParams,
  type HomeChatAttachUploadResult
} from '../../../../../shared/rpc-contract/home-chat-params'
import {
  homeChatRootDir,
  onHomeChatEvent,
  requireHomeChat
} from '../../../../home-chat/home-chat-install'
import {
  commitPhoneUpload,
  openPhoneDownload
} from '../../../../phone-transfers/phone-transfer-staging'
import { holdSubscription } from '../rpc-subscription-hold'

const safeSegment = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)

// Phones never see or change API keys: settings writes stay on the desktop.
export const HOME_CHAT_METHODS = [
  defineMethod({
    name: 'homeChat.list',
    permission: 'workspace',
    params: null,
    handler: async () => ({ chats: (await requireHomeChat()).listChats() })
  }),
  defineMethod({
    name: 'homeChat.get',
    permission: 'workspace',
    params: HomeChatIdParams,
    handler: async ({ chatId }) => ({ chat: (await requireHomeChat()).getChat(chatId) })
  }),
  defineMethod({
    name: 'homeChat.create',
    permission: 'workspace',
    params: HomeChatCreateParams,
    handler: async (params) => ({ chat: (await requireHomeChat()).createChat(params ?? {}) })
  }),
  defineMethod({
    name: 'homeChat.update',
    permission: 'workspace',
    params: HomeChatUpdateParams,
    handler: async (params) => ({ chat: await (await requireHomeChat()).updateChat(params) })
  }),
  defineMethod({
    name: 'homeChat.delete',
    permission: 'workspace',
    params: HomeChatIdParams,
    handler: async ({ chatId }) => {
      await (await requireHomeChat()).deleteChat(chatId)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'homeChat.send',
    permission: 'workspace',
    params: HomeChatSendParams,
    handler: async ({ chatId, text }) => {
      ;(await requireHomeChat()).send(chatId, text)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'homeChat.stop',
    permission: 'workspace',
    params: HomeChatIdParams,
    handler: async ({ chatId }) => {
      ;(await requireHomeChat()).stop(chatId)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'homeChat.respondApproval',
    permission: 'workspace',
    params: HomeChatRespondApprovalParams,
    handler: async ({ chatId, entryId, approved }) => ({
      handled: (await requireHomeChat()).respondApproval(chatId, entryId, approved)
    })
  }),
  defineMethod({
    name: 'homeChat.listAccounts',
    permission: 'workspace',
    params: null,
    handler: async () => ({ accounts: await (await requireHomeChat()).listAccounts() })
  }),
  defineMethod({
    name: 'homeChat.readAttachment',
    permission: 'workspace',
    params: HomeChatAttachmentParams,
    handler: async ({ chatId, attachmentId }) =>
      (await requireHomeChat()).readAttachment(chatId, attachmentId)
  }),
  defineMethod({
    name: 'homeChat.openAttachmentDownload',
    permission: 'workspace',
    params: HomeChatAttachmentParams,
    handler: async ({ chatId, attachmentId }) => {
      const path = await (await requireHomeChat()).attachmentPath(chatId, attachmentId)
      // Stored names carry an `<attachmentId>-` prefix.
      const stored = path.replaceAll('\\', '/').split('/').pop() ?? 'file'
      return openPhoneDownload(path, { fileName: stored.slice(attachmentId.length + 1) || stored })
    }
  }),
  defineMethod({
    name: 'homeChat.attachUpload',
    permission: 'workspace',
    params: HomeChatAttachUploadParams,
    handler: async ({ chatId, uploadId }): Promise<HomeChatAttachUploadResult> => {
      await requireHomeChat()
      const staged = await commitPhoneUpload(uploadId)
      try {
        const folder = join(homeChatRootDir(), 'uploads', safeSegment(chatId))
        await mkdir(folder, { recursive: true })
        const path = join(folder, `${Date.now()}-${safeSegment(staged.fileName)}`)
        await copyFile(staged.path, path)
        return { path, name: staged.fileName, size: staged.size }
      } finally {
        await staged.release()
      }
    }
  }),
  // Emits `ready` with the chat list, then every entry/summary/deleted event in order.
  defineStreamingMethod({
    name: 'homeChat.watch',
    permission: 'workspace',
    params: null,
    handler: async (_params, ctx, emit) => {
      const service = await requireHomeChat()
      await holdSubscription('home-chat', ctx, emit, (subscriptionId) => {
        const off = onHomeChatEvent((event) => emit({ type: 'event', event }))
        emit({ type: 'ready', subscriptionId, chats: service.listChats() })
        return off
      })
    }
  }),
  defineMethod({
    name: 'homeChat.unwatch',
    permission: 'workspace',
    params: HomeChatUnwatchParams,
    handler: ({ subscriptionId }, { runtime }) => {
      runtime.cleanupSubscription(subscriptionId)
      return { unsubscribed: true }
    }
  })
]
