/**
 * RPC methods whose text replies and stream events may be gzipped before sealing: bulk display
 * output and catalogs only. Compressed length leaks how well a frame's contents repeat each other,
 * so anything that can carry a credential (auth, pairing, relay and push tokens, account or
 * credential export, file contents) stays off this list and is sealed at its plain length.
 */
const COMPRESSIBLE_REPLY_METHODS: ReadonlySet<string> = new Set([
  'worktree.list',
  'worktree.ps',
  'repo.list',
  'project.list',
  'projectGroup.list',
  'folderWorkspace.list',
  'session.tabs.list',
  'session.tabs.listAll',
  'session.tabs.subscribe',
  'session.tabs.subscribeAll',
  'terminal.list',
  'terminal.read',
  'terminal.subscribe',
  'terminal.multiplex',
  'session.readTerminalScrollback',
  'agentSession.history',
  'agentSession.subscribe',
  'nativeChat.readSession',
  'nativeChat.subscribe',
  'liveSessions.transcript',
  'liveSessions.transcriptSince',
  'liveSessions.transcriptImage',
  'liveSessions.watchTranscript'
])

// Why bounded: listed requests are small, so a large one is a write whose reply stays plain unparsed.
const MAX_CLASSIFIED_REQUEST_CHARACTERS = 16 * 1024

/** True when the replies to this request may be compressed; false for anything unreadable or unlisted. */
export function isCompressibleReplyRequest(requestPlaintext: string): boolean {
  if (requestPlaintext.length > MAX_CLASSIFIED_REQUEST_CHARACTERS) {
    return false
  }
  try {
    const request: unknown = JSON.parse(requestPlaintext)
    return (
      typeof request === 'object' &&
      request !== null &&
      'method' in request &&
      typeof request.method === 'string' &&
      COMPRESSIBLE_REPLY_METHODS.has(request.method)
    )
  } catch {
    return false
  }
}
