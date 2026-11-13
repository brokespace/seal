import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type { ClaudeRateLimitAccountsState } from '../../shared/managed-account-types'
import type {
  HomeChatCreateArgs,
  HomeChatEvent,
  HomeChatSettingsUpdate,
  HomeChatUpdateArgs
} from '../../shared/home-chat/home-chat-types'
import type { HomeChatMemory } from '../../shared/home-chat/home-chat-memory-types'
import type { Repo } from '../../shared/repo-types'
import { createSealClaudeAccountsProvider } from '../home-chat/home-chat-accounts'
import { getSealAccountManager } from '../seal-accounts/seal-account-manager'
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

type AttachmentArgs = { chatId: string; attachmentId: string }

export function registerHomeChatHandlers(
  claudeAccounts: { listAccounts: () => ClaudeRateLimitAccountsState },
  repos: () => Repo[]
): void {
  const rootDir = join(app.getPath('userData'), 'home-chat')
  const ready = HomeChatStore.open(rootDir).then(async (store) => {
    const service = new HomeChatService({
      rootDir,
      store,
      accounts: createSealClaudeAccountsProvider({
        candidates: () => getSealAccountManager()?.candidates('claude') ?? null,
        listAccounts: () => claudeAccounts.listAccounts()
      }),
      createMachines: createDefaultHomeChatMachineProvider,
      runOrcaCli,
      repos,
      emit: broadcast
    })
    await service.start()
    return service
  })
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
  handle('homeChat:getMemory', (service) => service.getMemory())
  handle('homeChat:updateMemory', (service, args: { memory: HomeChatMemory }) =>
    service.updateMemory(args.memory)
  )
  handle('homeChat:readAttachment', (service, args: AttachmentArgs) =>
    service.readAttachment(args.chatId, args.attachmentId)
  )
  handle('homeChat:revealAttachment', async (service, args: AttachmentArgs) => {
    shell.showItemInFolder(await service.attachmentPath(args.chatId, args.attachmentId))
  })
  handle('homeChat:saveAttachment', async (service, args: AttachmentArgs & { name: string }) => {
    const parent = BrowserWindow.getFocusedWindow()
    const options = { defaultPath: join(app.getPath('downloads'), args.name) }
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) {
      return false
    }
    await service.saveAttachment(args.chatId, args.attachmentId, result.filePath)
    return true
  })
}
