import type {
  LiveRemoveRequest,
  LiveSession
} from '../../../shared/live-sessions/live-session-types'
import { liveSessionTranscriptFiles } from '../../../shared/live-sessions/live-session-transcript-files'
import { LiveSessionJsonStore } from '../live-session-json-store'
import type { LiveSessionHost } from '../hosts/live-session-hosts'
import { stopAgentScript } from './session-take-over'

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

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
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
    lines.push(`tmux -S ${shQuote(pane.socket!)} kill-pane -t ${shQuote(pane.target)} 2>/dev/null`)
  }
  if (request.deleteTranscripts) {
    for (const file of liveSessionTranscriptFiles(session)) {
      lines.push(
        file.endsWith('/')
          ? `[ -d ${shQuote(file)} ] && rm -rf -- ${shQuote(file)}`
          : `rm -f -- ${shQuote(file)}`
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
