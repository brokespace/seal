import { ipcRenderer } from 'electron'
import type {
  LiveMessage,
  LivePermissionAnswer,
  LivePermissionAnswerResult,
  LiveSendRequest,
  LiveSessionAnnotation,
  LiveSessionRegistryEvent,
  LiveSessionRegistrySnapshot,
  LiveTakeOverResult,
  LiveRemoveRequest,
  LiveRemoveResult,
  LiveTranscriptCursor,
  LiveTranscriptDelta,
  LiveTranscriptPage
} from '../../../shared/live-sessions/live-session-types'
import type {
  ShellIntegrationAction,
  ShellIntegrationStatus
} from '../../../shared/shell-integration/shell-integration-installer'
import { LIVE_SESSION_IPC } from '../../../shared/live-sessions/live-session-ipc-channels'

export type LiveSessionsApi = {
  snapshot: () => Promise<LiveSessionRegistrySnapshot>
  refresh: () => Promise<void>
  onEvent: (callback: (event: LiveSessionRegistryEvent) => void) => () => void
  transcriptPage: (args: {
    sessionId: string
    before?: LiveTranscriptCursor | null
    limit?: number
  }) => Promise<LiveTranscriptPage>
  /** Without `fromCursor` the newest page comes back; with one, the catch-up arrives as a delta. */
  watchTranscript: (args: {
    sessionId: string
    fromCursor?: LiveTranscriptCursor | null
  }) => Promise<{ watchId: string; page: LiveTranscriptPage | null }>
  unwatchTranscript: (args: { watchId: string }) => Promise<void>
  onTranscriptDelta: (
    callback: (payload: { watchId: string; delta: LiveTranscriptDelta }) => void
  ) => () => void
  send: (request: LiveSendRequest) => Promise<LiveMessage>
  retry: (args: { messageId: string }) => Promise<LiveMessage | null>
  messages: (args?: { sessionId?: string }) => Promise<LiveMessage[]>
  onMessage: (callback: (message: LiveMessage) => void) => () => void
  /** The user clicked a session's desktop notification. */
  onOpen: (callback: (payload: { sessionId: string }) => void) => () => void
  answer: (answer: LivePermissionAnswer) => Promise<LivePermissionAnswerResult>
  takeOver: (args: { sessionId: string }) => Promise<LiveTakeOverResult>
  /** Hide for good; optionally stop the agent and delete its transcript first. */
  remove: (request: LiveRemoveRequest) => Promise<LiveRemoveResult>
  /** Rename or pin a session in Seal; the registry publishes the change. */
  annotate: (annotation: LiveSessionAnnotation) => Promise<void>
  /** `hostId` is 'local' or an SSH target id; rejects when that host is not connected. */
  shellIntegration: (args: {
    hostId: string
    action: ShellIntegrationAction
  }) => Promise<ShellIntegrationStatus>
}

function listen<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export const liveSessionsApi: LiveSessionsApi = {
  snapshot: () => ipcRenderer.invoke(LIVE_SESSION_IPC.snapshot),
  refresh: () => ipcRenderer.invoke(LIVE_SESSION_IPC.refresh),
  onEvent: (callback) => listen(LIVE_SESSION_IPC.event, callback),
  transcriptPage: (args) => ipcRenderer.invoke(LIVE_SESSION_IPC.transcriptPage, args),
  watchTranscript: (args) => ipcRenderer.invoke(LIVE_SESSION_IPC.watchTranscript, args),
  unwatchTranscript: (args) => ipcRenderer.invoke(LIVE_SESSION_IPC.unwatchTranscript, args),
  onTranscriptDelta: (callback) => listen(LIVE_SESSION_IPC.transcriptDelta, callback),
  send: (request) => ipcRenderer.invoke(LIVE_SESSION_IPC.send, request),
  retry: (args) => ipcRenderer.invoke(LIVE_SESSION_IPC.retry, args),
  messages: (args) => ipcRenderer.invoke(LIVE_SESSION_IPC.messages, args),
  onMessage: (callback) => listen(LIVE_SESSION_IPC.message, callback),
  onOpen: (callback) => listen(LIVE_SESSION_IPC.open, callback),
  answer: (answer) => ipcRenderer.invoke(LIVE_SESSION_IPC.answer, answer),
  takeOver: (args) => ipcRenderer.invoke(LIVE_SESSION_IPC.takeOver, args),
  remove: (request) => ipcRenderer.invoke(LIVE_SESSION_IPC.remove, request),
  annotate: (annotation) => ipcRenderer.invoke(LIVE_SESSION_IPC.annotate, annotation),
  shellIntegration: (args) => ipcRenderer.invoke(LIVE_SESSION_IPC.shellIntegration, args)
}
