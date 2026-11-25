import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type {
  ClaudeRateLimitAccountsState,
  CodexManagedAccount
} from '../../shared/managed-account-types'
import type {
  HomeChatCreateArgs,
  HomeChatEvent,
  HomeChatSettingsUpdate,
  HomeChatUpdateArgs
} from '../../shared/home-chat/home-chat-types'
import type { HomeChatMemory } from '../../shared/home-chat/home-chat-memory-types'
import type { Repo } from '../../shared/repo-types'
import type { HomeChatService } from '../home-chat/home-chat-service'
import { installHomeChat, onHomeChatEvent } from '../home-chat/home-chat-install'
import { getMachineRegistry } from '../machines/registry/machine-registry-service'
import type { MachineView } from '../../shared/machines/machine-view'
import { summarizeMachine, type MachineSummary } from '../../shared/machines/machine-summaries'
import { getRegisteredSshState } from '../ssh/targets/ssh-target-registry'
import { getRuntimeEnvironmentStatusSnapshot } from './runtime-environments/connections/runtime-environment-request-connections'

export const HOME_CHAT_EVENT_CHANNEL = 'homeChat:event'

function summarizeForAssistant(view: MachineView): MachineSummary {
  const sshState = view.ssh ? getRegisteredSshState(view.ssh.targetId) : undefined
  const snapshot = view.server
    ? getRuntimeEnvironmentStatusSnapshot(view.server.environmentId)
    : null
  return summarizeMachine(view, {
    sshStates: new Map(view.ssh && sshState ? [[view.ssh.targetId, sshState]] : []),
    runtimeStatuses: new Map(view.server && snapshot ? [[view.server.environmentId, snapshot]] : [])
  })
}

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

export type HomeChatHandlerSources = {
  claudeAccounts: { listAccounts: () => ClaudeRateLimitAccountsState }
  codexAccounts: () => readonly CodexManagedAccount[]
  repos: () => Repo[]
}

export function registerHomeChatHandlers(sources: HomeChatHandlerSources): void {
  const ready = installHomeChat({
    ...sources,
    machines: {
      list: () => getMachineRegistry().list(),
      summarize: summarizeForAssistant,
      connection: (machineId) => getMachineRegistry().connection(machineId)
    }
  })
  onHomeChatEvent(broadcast)
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
  handle('homeChat:compact', (service, args: { chatId: string }) => service.compact(args.chatId))
  handle('homeChat:listMachines', (service) => service.listMachines())
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
