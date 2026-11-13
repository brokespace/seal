import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import type { ClaudeRateLimitAccountsState } from '../../shared/managed-account-types'
import type {
  HomeChatCreateArgs,
  HomeChatEvent,
  HomeChatSettingsUpdate,
  HomeChatUpdateArgs
} from '../../shared/home-chat/home-chat-types'
import { createClaudeAccountsProvider } from '../home-chat/home-chat-accounts'
import { HomeChatService } from '../home-chat/home-chat-service'
import { HomeChatStore } from '../home-chat/home-chat-store'
import { createDefaultHomeChatMachineProvider } from '../home-chat/machines/home-chat-machine-provider'
import { runOrcaCli } from '../home-chat/tools/home-chat-orca-cli'

export const HOME_CHAT_EVENT_CHANNEL = 'homeChat:event'

function broadcast(event: HomeChatEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }
    try {
      window.webContents.send(HOME_CHAT_EVENT_CHANNEL, event)
    } catch {
      // A renderer can disappear between isDestroyed() and send().
    }
  }
}

export function registerHomeChatHandlers(claudeAccounts: {
  listAccounts: () => ClaudeRateLimitAccountsState
}): void {
  const rootDir = join(app.getPath('userData'), 'home-chat')
  const service = new HomeChatService({
    rootDir,
    store: new HomeChatStore(rootDir),
    accounts: createClaudeAccountsProvider(claudeAccounts),
    machines: createDefaultHomeChatMachineProvider(),
    runOrcaCli,
    emit: broadcast
  })
  app.once('before-quit', () => {
    void service.dispose()
  })

  ipcMain.handle('homeChat:list', () => service.listChats())
  ipcMain.handle('homeChat:get', (_event, args: { chatId: string }) => service.getChat(args.chatId))
  ipcMain.handle('homeChat:create', (_event, args?: HomeChatCreateArgs) => service.createChat(args))
  ipcMain.handle('homeChat:update', (_event, args: HomeChatUpdateArgs) => service.updateChat(args))
  ipcMain.handle('homeChat:delete', (_event, args: { chatId: string }) =>
    service.deleteChat(args.chatId)
  )
  ipcMain.handle('homeChat:send', (_event, args: { chatId: string; text: string }) =>
    service.send(args.chatId, args.text)
  )
  ipcMain.handle('homeChat:stop', (_event, args: { chatId: string }) => service.stop(args.chatId))
  ipcMain.handle(
    'homeChat:respondApproval',
    (_event, args: { chatId: string; entryId: string; approved: boolean }) =>
      service.respondApproval(args.chatId, args.entryId, args.approved)
  )
  ipcMain.handle('homeChat:getSettings', () => service.getSettings())
  ipcMain.handle('homeChat:updateSettings', (_event, args: HomeChatSettingsUpdate) =>
    service.updateSettings(args)
  )
  ipcMain.handle('homeChat:listAccounts', () => service.listAccounts())
}
