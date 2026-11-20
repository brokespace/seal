import type {
  HomeChat,
  HomeChatAccountOption,
  HomeChatCreateArgs,
  HomeChatEvent,
  HomeChatMachineOption,
  HomeChatSettings,
  HomeChatSettingsUpdate,
  HomeChatSummary,
  HomeChatUpdateArgs
} from '../../../shared/home-chat/home-chat-types'
import type { HomeChatMemory } from '../../../shared/home-chat/home-chat-memory-types'

type HomeChatAttachmentRef = { chatId: string; attachmentId: string }

export type HomeChatApi = {
  list: () => Promise<HomeChatSummary[]>
  get: (args: { chatId: string }) => Promise<HomeChat | null>
  create: (args?: HomeChatCreateArgs) => Promise<HomeChat>
  update: (args: HomeChatUpdateArgs) => Promise<HomeChatSummary>
  delete: (args: { chatId: string }) => Promise<void>
  send: (args: { chatId: string; text: string }) => Promise<void>
  stop: (args: { chatId: string }) => Promise<void>
  /** Summarize older messages for the model now; false when there is nothing to summarize. */
  compact: (args: { chatId: string }) => Promise<boolean>
  listMachines: () => Promise<HomeChatMachineOption[]>
  respondApproval: (args: {
    chatId: string
    entryId: string
    approved: boolean
  }) => Promise<boolean>
  getSettings: () => Promise<HomeChatSettings>
  updateSettings: (args: HomeChatSettingsUpdate) => Promise<HomeChatSettings>
  listAccounts: () => Promise<HomeChatAccountOption[]>
  getMemory: () => Promise<HomeChatMemory>
  updateMemory: (args: { memory: HomeChatMemory }) => Promise<HomeChatMemory>
  readAttachment: (args: HomeChatAttachmentRef) => Promise<{ mimeType: string; base64: string }>
  revealAttachment: (args: HomeChatAttachmentRef) => Promise<void>
  /** False when the user cancels the save dialog. */
  saveAttachment: (args: HomeChatAttachmentRef & { name: string }) => Promise<boolean>
  onEvent: (callback: (event: HomeChatEvent) => void) => () => void
}
