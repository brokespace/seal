import { ipcRenderer } from 'electron'
import type { HomeChatEvent } from '../../../shared/home-chat/home-chat-types'
import type { HomeChatApi } from './home-chat-api'

export const homeChatApi = {
  list: () => ipcRenderer.invoke('homeChat:list'),
  get: (args) => ipcRenderer.invoke('homeChat:get', args),
  create: (args) => ipcRenderer.invoke('homeChat:create', args),
  update: (args) => ipcRenderer.invoke('homeChat:update', args),
  delete: (args) => ipcRenderer.invoke('homeChat:delete', args),
  send: (args) => ipcRenderer.invoke('homeChat:send', args),
  stop: (args) => ipcRenderer.invoke('homeChat:stop', args),
  compact: (args) => ipcRenderer.invoke('homeChat:compact', args),
  listMachines: () => ipcRenderer.invoke('homeChat:listMachines'),
  respondApproval: (args) => ipcRenderer.invoke('homeChat:respondApproval', args),
  getSettings: () => ipcRenderer.invoke('homeChat:getSettings'),
  updateSettings: (args) => ipcRenderer.invoke('homeChat:updateSettings', args),
  listAccounts: () => ipcRenderer.invoke('homeChat:listAccounts'),
  getMemory: () => ipcRenderer.invoke('homeChat:getMemory'),
  updateMemory: (args) => ipcRenderer.invoke('homeChat:updateMemory', args),
  readAttachment: (args) => ipcRenderer.invoke('homeChat:readAttachment', args),
  revealAttachment: (args) => ipcRenderer.invoke('homeChat:revealAttachment', args),
  saveAttachment: (args) => ipcRenderer.invoke('homeChat:saveAttachment', args),
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: HomeChatEvent): void =>
      callback(payload)
    ipcRenderer.on('homeChat:event', listener)
    return () => ipcRenderer.removeListener('homeChat:event', listener)
  }
} satisfies HomeChatApi
