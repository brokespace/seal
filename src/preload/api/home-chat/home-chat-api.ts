import type {
  HomeChat,
  HomeChatAccountOption,
  HomeChatCreateArgs,
  HomeChatEvent,
  HomeChatSettings,
  HomeChatSettingsUpdate,
  HomeChatSummary,
  HomeChatUpdateArgs
} from '../../../shared/home-chat/home-chat-types'

export type HomeChatApi = {
  list: () => Promise<HomeChatSummary[]>
  get: (args: { chatId: string }) => Promise<HomeChat | null>
  create: (args?: HomeChatCreateArgs) => Promise<HomeChat>
  update: (args: HomeChatUpdateArgs) => Promise<HomeChatSummary>
  delete: (args: { chatId: string }) => Promise<void>
  send: (args: { chatId: string; text: string }) => Promise<void>
  stop: (args: { chatId: string }) => Promise<void>
  respondApproval: (args: {
    chatId: string
    entryId: string
    approved: boolean
  }) => Promise<boolean>
  getSettings: () => Promise<HomeChatSettings>
  updateSettings: (args: HomeChatSettingsUpdate) => Promise<HomeChatSettings>
  listAccounts: () => Promise<HomeChatAccountOption[]>
  onEvent: (callback: (event: HomeChatEvent) => void) => () => void
}
