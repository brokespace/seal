import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import type {
  LivePermissionAnswer,
  LiveSendRequest,
  LiveTranscriptCursor
} from '../../shared/live-sessions/live-session-types'
import { LIVE_SESSION_IPC } from '../../shared/live-sessions/live-session-ipc-channels'
import { LiveSessionRemoveParams } from '../../shared/live-sessions/live-session-rpc-params'
import type { LiveSessionService } from './live-session-service'
import type {
  ShellIntegrationAction,
  ShellIntegrationStatus
} from '../../shared/shell-integration/shell-integration-installer'

const SHELL_INTEGRATION_ACTIONS: readonly ShellIntegrationAction[] = [
  'install',
  'uninstall',
  'status',
  'enable',
  'disable'
]

function shellIntegrationActionOf(value: unknown): ShellIntegrationAction | null {
  return SHELL_INTEGRATION_ACTIONS.find((action) => action === value) ?? null
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

function isString(value: unknown, max = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function cursorOf(value: unknown): LiveTranscriptCursor | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function registerLiveSessionIpc(
  service: LiveSessionService,
  shellIntegration: (
    hostId: string,
    action: ShellIntegrationAction
  ) => Promise<ShellIntegrationStatus>
): void {
  service.subscribe((event) => broadcast(LIVE_SESSION_IPC.event, event))
  service.subscribeMessages((message) => broadcast(LIVE_SESSION_IPC.message, message))

  const watches = new Map<string, { sender: WebContents; unsubscribe: () => void }>()
  let nextWatch = 0

  ipcMain.handle(LIVE_SESSION_IPC.snapshot, () => service.snapshot())
  ipcMain.handle(LIVE_SESSION_IPC.refresh, () => service.refresh())
  ipcMain.handle(
    LIVE_SESSION_IPC.transcriptPage,
    (_event, args: { sessionId: unknown; before?: unknown; limit?: unknown }) => {
      if (!isString(args?.sessionId)) {
        throw new Error('sessionId is required')
      }
      const limit =
        typeof args.limit === 'number'
          ? Math.min(500, Math.max(1, Math.floor(args.limit)))
          : undefined
      return service.transcriptPage(args.sessionId, cursorOf(args.before), limit)
    }
  )
  ipcMain.handle(
    LIVE_SESSION_IPC.watchTranscript,
    async (event, args: { sessionId: unknown; fromCursor?: unknown }) => {
      if (!isString(args?.sessionId)) {
        throw new Error('sessionId is required')
      }
      const watchId = `w${++nextWatch}`
      const sender = event.sender
      const subscription = service.watchTranscript(
        args.sessionId,
        cursorOf(args.fromCursor),
        (delta) => {
          if (!sender.isDestroyed()) {
            sender.send(LIVE_SESSION_IPC.transcriptDelta, { watchId, delta })
          }
        }
      )
      const unsubscribe = () => {
        subscription.unsubscribe()
        watches.delete(watchId)
      }
      watches.set(watchId, { sender, unsubscribe })
      sender.once('destroyed', unsubscribe)
      return { watchId, page: await subscription.ready }
    }
  )
  ipcMain.handle(LIVE_SESSION_IPC.unwatchTranscript, (event, args: { watchId: unknown }) => {
    const watch = isString(args?.watchId) ? watches.get(args.watchId) : undefined
    if (watch && watch.sender === event.sender) {
      watch.unsubscribe()
    }
  })
  ipcMain.handle(LIVE_SESSION_IPC.send, (_event, args: LiveSendRequest) => {
    if (
      !isString(args?.sessionId) ||
      !isString(args?.messageId, 128) ||
      !isString(args?.text, 100_000)
    ) {
      throw new Error('sessionId, messageId and text are required')
    }
    return service.send({ sessionId: args.sessionId, messageId: args.messageId, text: args.text })
  })
  ipcMain.handle(LIVE_SESSION_IPC.retry, (_event, args: { messageId: unknown }) => {
    if (!isString(args?.messageId, 128)) {
      throw new Error('messageId is required')
    }
    return service.retry(args.messageId)
  })
  ipcMain.handle(LIVE_SESSION_IPC.messages, (_event, args?: { sessionId?: unknown }) =>
    service.messages(isString(args?.sessionId) ? args.sessionId : undefined)
  )
  ipcMain.handle(LIVE_SESSION_IPC.answer, (_event, args: LivePermissionAnswer) => {
    if (
      !isString(args?.sessionId) ||
      !isString(args?.promptId, 256) ||
      !isString(args?.optionId, 64)
    ) {
      throw new Error('sessionId, promptId and optionId are required')
    }
    return service.answer({
      sessionId: args.sessionId,
      promptId: args.promptId,
      optionId: args.optionId
    })
  })
  ipcMain.handle(LIVE_SESSION_IPC.takeOver, (_event, args: { sessionId: unknown }) => {
    if (!isString(args?.sessionId)) {
      throw new Error('sessionId is required')
    }
    return service.takeOver(args.sessionId)
  })
  ipcMain.handle(LIVE_SESSION_IPC.remove, (_event, args: unknown) =>
    service.remove(LiveSessionRemoveParams.parse(args))
  )
  ipcMain.handle(
    LIVE_SESSION_IPC.shellIntegration,
    (_event, args: { hostId: unknown; action: unknown }) => {
      const action = shellIntegrationActionOf(args?.action)
      if (!isString(args?.hostId, 256) || !action) {
        throw new Error('hostId and a shell integration action are required')
      }
      return shellIntegration(args.hostId, action)
    }
  )
}
