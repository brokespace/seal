import type {
  LiveRemoveRequest,
  LiveSession
} from '../../../shared/live-sessions/live-session-types'
import { localChatSessionId } from '../../../shared/live-sessions/live-session-paired-server'
import { liveSessionTranscriptFiles } from '../../../shared/live-sessions/live-session-transcript-files'
import { LiveSessionJsonStore } from '../live-session-json-store'
import type { LiveSessionHost } from '../hosts/live-session-hosts'
import { stopAgentScript } from './session-take-over'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'

type Removal = { sessionId: string; removedAt: number }

function isRemoval(item: unknown): item is Removal {
  return (
    typeof item === 'object' &&
    item !== null &&
    'sessionId' in item &&
    typeof item.sessionId === 'string' &&
    'removedAt' in item &&
    typeof item.removedAt === 'number'
  )
}

/** `tmux -L seal` serves Seal's wrapper sessions from a socket named `seal`. */
export function isSealTmuxSocket(socket: string | null | undefined): boolean {
  return socket?.split('/').pop() === 'seal'
}

/** Closes the Seal tmux pane the agent ran in and deletes the files the user agreed to. */
export function sessionCleanupScript(session: LiveSession, request: LiveRemoveRequest): string {
  const lines: string[] = []
  const pane = session.inputRoutes.find((route) => route.kind === 'tmux')
  if (request.stop && pane?.kind === 'tmux' && isSealTmuxSocket(pane.socket)) {
    lines.push(
      `tmux -S ${quotePosixShell(pane.socket!)} kill-pane -t ${quotePosixShell(pane.target)} 2>/dev/null`
    )
  }
  if (request.deleteTranscripts) {
    for (const file of liveSessionTranscriptFiles(session)) {
      lines.push(
        file.endsWith('/')
          ? `[ -d ${quotePosixShell(file)} ] && rm -rf -- ${quotePosixShell(file)}`
          : `rm -f -- ${quotePosixShell(file)}`
      )
    }
  }
  return [...lines, 'echo @@DONE'].join('\n')
}

/** Stops (when asked) and cleans up one session on its host; hiding is the caller's. */
export async function removeFromHost(
  session: LiveSession,
  host: LiveSessionHost,
  request: LiveRemoveRequest
): Promise<'removed' | 'still_running'> {
  if (request.stop && session.alive && session.pid !== null) {
    const out = await host.run(stopAgentScript(session.pid, session.provider))
    if (!out.includes('@@STOPPED')) {
      return 'still_running'
    }
  }
  if (request.stop || request.deleteTranscripts) {
    await host.run(sessionCleanupScript(session, request))
  }
  return 'removed'
}

/** Stops and cleans up through whoever runs the session: its server, its chat host, its machine. */
export async function removeFromOwner(
  session: LiveSession,
  request: LiveRemoveRequest,
  owner: {
    server: {
      remove(sessionId: string, request: LiveRemoveRequest): Promise<'removed' | 'still_running'>
    } | null
    chats: { stop(chatSessionId: string): Promise<boolean> } | null
    host: LiveSessionHost | null
  }
): Promise<'removed' | 'still_running'> {
  if (owner.server) {
    return request.stop || request.deleteTranscripts
      ? owner.server.remove(session.id, request)
      : 'removed'
  }
  if (session.surface.kind === 'chat') {
    const chat = localChatSessionId(session)
    if (chat === null) {
      // A server's chat with its server out of reach: nothing here can end it.
      return request.stop ? 'still_running' : 'removed'
    }
    // The chat's host ends its agent: a signal to the pid would leave the host holding a dead chat.
    const stopped = !request.stop || ((await owner.chats?.stop(chat)) ?? true)
    return stopped ? 'removed' : 'still_running'
  }
  return owner.host ? removeFromHost(session, owner.host, request) : 'removed'
}

/** Sessions the user removed from Seal; they stay hidden across rescans and restarts. */
export class LiveSessionRemovals {
  private readonly removed = new Map<string, number>()
  private readonly store: LiveSessionJsonStore<Removal>
  private loading: Promise<void> | null = null

  constructor(path: string, log?: (message: string, error?: unknown) => void) {
    this.store = new LiveSessionJsonStore(path, isRemoval, log)
  }

  load(): Promise<void> {
    this.loading ??= this.store.load().then((items) => {
      for (const { sessionId, removedAt } of items) {
        this.removed.set(sessionId, removedAt)
      }
    })
    return this.loading
  }

  has(sessionId: string): boolean {
    return this.removed.has(sessionId)
  }

  add(sessionIds: readonly string[], now: number): void {
    for (const sessionId of sessionIds) {
      this.removed.set(sessionId, now)
    }
    this.store.save([...this.removed].map(([sessionId, removedAt]) => ({ sessionId, removedAt })))
  }

  flush(): Promise<void> {
    return this.store.flush()
  }
}
