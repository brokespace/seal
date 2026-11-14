export const LIVE_SESSION_IPC = {
  snapshot: 'liveSessions:snapshot',
  refresh: 'liveSessions:refresh',
  transcriptPage: 'liveSessions:transcriptPage',
  watchTranscript: 'liveSessions:watchTranscript',
  unwatchTranscript: 'liveSessions:unwatchTranscript',
  send: 'liveSessions:send',
  retry: 'liveSessions:retry',
  messages: 'liveSessions:messages',
  answer: 'liveSessions:answer',
  takeOver: 'liveSessions:takeOver',
  remove: 'liveSessions:remove',
  shellIntegration: 'liveSessions:shellIntegration',
  /** main → renderer: LiveSessionRegistryEvent */
  event: 'liveSessions:event',
  /** main → renderer: LiveMessage */
  message: 'liveSessions:message',
  /** main → renderer: { watchId, delta: LiveTranscriptDelta } */
  transcriptDelta: 'liveSessions:transcriptDelta'
} as const
