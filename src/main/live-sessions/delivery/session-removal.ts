import type {
  LiveRemoveRequest,
  LiveRemoveResult,
  LiveSession
} from '../../../shared/live-sessions/live-session-types'
import { errorMessage } from '../../../shared/error-message'
import { localChatSessionId } from '../../../shared/live-sessions/live-session-paired-server'
import { liveSessionTranscriptFiles } from '../../../shared/live-sessions/live-session-transcript-files'
import { LiveSessionJsonStore } from '../live-session-json-store'
import type { LiveSessionHost } from '../hosts/live-session-hosts'
import { sideBySideHosts } from '../hosts/side-by-side-host-run'
import { stopAgentScript } from './session-take-over'
import type { StructuredSessionAccess } from '../sources/structured-session-source'
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

/**
 * One script for a session: ends its agent, closes the Seal tmux pane it ran in and deletes the
 * files the user agreed to. The pane is closed before the verdict, so an agent that outlives
 * SIGKILL loses its terminal too.
 */
export function sessionRemovalScript(session: LiveSession, request: LiveRemoveRequest): string {
  const pane = session.inputRoutes.find((route) => route.kind === 'tmux')
  const closePane =
    request.stop && pane?.kind === 'tmux' && isSealTmuxSocket(pane.socket)
      ? [
          `tmux -S ${quotePosixShell(pane.socket!)} kill-pane -t ${quotePosixShell(pane.target)} 2>/dev/null`
        ]
      : []
  const deletions = request.deleteTranscripts
    ? liveSessionTranscriptFiles(session).map((file) =>
        file.endsWith('/')
          ? `[ -d ${quotePosixShell(file)} ] && rm -rf -- ${quotePosixShell(file)}`
          : `rm -f -- ${quotePosixShell(file)}`
      )
    : []
  if (!stopsAgent(session, request)) {
    return [...closePane, ...deletions, 'echo @@DONE'].join('\n')
  }
  return [
    stopAgentScript(session.pid!, session.provider, closePane.join('\n')),
    // An agent that kept running would only write its files again.
    ...(deletions.length > 0 ? ['if [ "$stopped" = 1 ]; then', ...deletions, 'fi'] : []),
    'echo @@DONE'
  ].join('\n')
}

function stopsAgent(session: LiveSession, request: LiveRemoveRequest): boolean {
  return request.stop && session.alive && session.pid !== null
}

/** Stops (when asked) and cleans up one session on its host in one run; hiding is the caller's. */
export async function removeFromHost(
  session: LiveSession,
  host: LiveSessionHost,
  request: LiveRemoveRequest
): Promise<'removed' | 'still_running'> {
  if (!request.stop && !request.deleteTranscripts) {
    return 'removed'
  }
  const out = await host.run(sessionRemovalScript(session, request))
  return stopsAgent(session, request) && !out.includes('@@STOPPED') ? 'still_running' : 'removed'
}

/** Stops and cleans up through whoever runs the session: its server, its chat host, its machine. */
export async function removeFromOwner(
  session: LiveSession,
  request: LiveRemoveRequest,
  owner: {
    server: {
      remove(sessionId: string, request: LiveRemoveRequest): Promise<'removed' | 'still_running'>
    } | null
    chats: Pick<StructuredSessionAccess, 'stop' | 'deleteTranscripts'> | null
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
    if (!stopped) {
      return 'still_running'
    }
    if (request.deleteTranscripts) {
      await owner.chats?.deleteTranscripts(session)
    }
    return 'removed'
  }
  return owner.host ? removeFromHost(session, owner.host, request) : 'removed'
}

type RemovalOwner = Parameters<typeof removeFromOwner>[2]

const NOTHING_TO_STOP: ReturnType<typeof removeFromOwner> = Promise.resolve('removed')

/**
 * Removes sessions the way the user sees it: they leave the list at once, then all of them are
 * stopped and cleaned up together, a machine's sessions in one run. One that kept running, or
 * could not be reached, is listed again.
 */
export async function removeSessions(
  request: LiveRemoveRequest,
  deps: {
    session(sessionId: string): LiveSession | null
    owner(session: LiveSession): RemovalOwner
    removals: Pick<LiveSessionRemovals, 'hold' | 'release' | 'add'>
    /** The list changed: sessions were hidden, or one of them is shown again. */
    onListChanged(): void
    now(): number
  }
): Promise<{ result: LiveRemoveResult; sessions: LiveSession[]; removed: LiveSession[] }> {
  // Read before they are hidden: a hidden session is no longer listed.
  const asked = [...new Set(request.sessionIds)].map((sessionId) => {
    const session = deps.session(sessionId)
    // Asked for by an id it has left behind since, it is hidden under the one it goes by now too.
    return { sessionId, session, ids: [...new Set([sessionId, ...(session ? [session.id] : [])])] }
  })
  if (!request.keep) {
    deps.removals.hold(asked.flatMap(({ ids }) => ids))
    deps.onListChanged()
  }
  const sideBySide = sideBySideHosts()
  const stop = (session: LiveSession): ReturnType<typeof removeFromOwner> => {
    const owner = deps.owner(session)
    return removeFromOwner(session, request, { ...owner, host: sideBySide(owner.host) })
  }
  // Each owner settles on its own: what kept running there is listed again without waiting for the rest.
  const failures = await Promise.all(
    asked.map(async ({ sessionId, session, ids }) => {
      const failure = await (session ? stop(session) : NOTHING_TO_STOP).then(
        (outcome) => (outcome === 'removed' ? null : { sessionId, reason: outcome }),
        (error: unknown) => ({ sessionId, reason: 'failed' as const, error: errorMessage(error) })
      )
      if (failure) {
        deps.removals.release(ids)
      } else if (!request.keep) {
        deps.removals.add(ids, deps.now())
      }
      deps.onListChanged()
      return failure
    })
  )
  return {
    result: {
      removed: asked.flatMap(({ sessionId }, index) => (failures[index] ? [] : sessionId)),
      failed: failures.flatMap((failure) => failure ?? [])
    },
    sessions: asked.flatMap(({ session }) => session ?? []),
    removed: asked.flatMap(({ session }, index) => (session && !failures[index] ? session : []))
  }
}

/** Sessions the user removed from Seal; they stay hidden across rescans and restarts. */
export class LiveSessionRemovals {
  private readonly removed = new Map<string, number>()
  private readonly stopping = new Set<string>()
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
    return this.removed.has(sessionId) || this.stopping.has(sessionId)
  }

  /** Hides sessions while Seal stops them. Not saved: one that keeps running is shown again. */
  hold(sessionIds: readonly string[]): void {
    for (const sessionId of sessionIds) {
      this.stopping.add(sessionId)
    }
  }

  release(sessionIds: readonly string[]): void {
    for (const sessionId of sessionIds) {
      this.stopping.delete(sessionId)
    }
  }

  add(sessionIds: readonly string[], now: number): void {
    this.release(sessionIds)
    for (const sessionId of sessionIds) {
      this.removed.set(sessionId, now)
    }
    this.store.save([...this.removed].map(([sessionId, removedAt]) => ({ sessionId, removedAt })))
  }

  flush(): Promise<void> {
    return this.store.flush()
  }
}
