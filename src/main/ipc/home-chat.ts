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
  const ready = HomeChatStore.open(rootDir).then(
    (store) =>
      new HomeChatService({
        rootDir,
        store,
        accounts: createClaudeAccountsProvider(claudeAccounts),
        machines: createDefaultHomeChatMachineProvider(),
        runOrcaCli,
        emit: broadcast
      })
  )
  app.once('before-quit', () => {
    void ready.then((service) => service.dispose())
  })
  const handle = <Args, Result>(
    channel: string,
    run: (service: HomeChatService, args: Args) => Result
  ): void => {
    ipcMain.handle(channel, async (_event, args: Args) => run(await ready, args))
  }

  handle('homeChat:list', (service) => service.listChats())
  handle('homeChat:get', (service, args: { chatId: string }) => service.getChat(args.chatId))
  handle('homeChat:create', (service, args?: HomeChatCreateArgs) => service.createChat(args))
  handle('homeChat:update', (service, args: HomeChatUpdateArgs) => service.updateChat(args))
  handle('homeChat:delete', (service, args: { chatId: string }) => service.deleteChat(args.chatId))
  handle('homeChat:send', (service, args: { chatId: string; text: string }) =>
    service.send(args.chatId, args.text)
  )
  handle('homeChat:stop', (service, args: { chatId: string }) => service.stop(args.chatId))
  handle(
    'homeChat:respondApproval',
    (service, args: { chatId: string; entryId: string; approved: boolean }) =>
      service.respondApproval(args.chatId, args.entryId, args.approved)
  )
  handle('homeChat:getSettings', (service) => service.getSettings())
  handle('homeChat:updateSettings', (service, args: HomeChatSettingsUpdate) =>
    service.updateSettings(args)
  )
  handle('homeChat:listAccounts', (service) => service.listAccounts())
}
