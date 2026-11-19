import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import { sessionRecapViewSchema } from '../../shared/session-recap/session-recap-schemas'
import type {
  RecapItemMark,
  SessionRecapView
} from '../../shared/session-recap/session-recap-types'
import { serverSessionId } from '../live-sessions/federation/federated-session-records'
import { serverOf } from '../session-summaries/server-session-summaries'

export type ServerSessionRecapsDeps = {
  /** A paired Seal server's answer to a runtime call; null when it could not answer. */
  call: (
    executionHostId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown>
}

const READ_TIMEOUT_MS = 15_000
/** As long as a client waits for its own Refresh: a rebuild is several model calls. */
const REFRESH_TIMEOUT_MS = 6 * 60_000

function unanswered(sessionId: string, message: string | null = null): SessionRecapView {
  return {
    sessionId,
    recap: null,
    marks: {},
    since: null,
    state: 'failed',
    stale: false,
    pausedUntil: null,
    failure: 'The server that runs this session did not answer',
    rev: 0,
    unavailableReason: { kind: 'server-unreachable', message }
  }
}

/**
 * A server from before the judge lists under `ignored` what its read step proposed, and sends no
 * `turnEnded`. Nothing is called not addressed on that word alone.
 */
function judgedOnly(view: SessionRecapView): SessionRecapView {
  return view.turnEnded === undefined && view.recap
    ? { ...view, recap: { ...view.recap, ignored: [] } }
    : view
}

/**
 * The recaps paired servers keep for the sessions they run. A session has one recap, made by the
 * host that runs it: this host makes none for these sessions, whether or not their server can, and
 * forwards a client's read, Refresh or tick. The row's brief arrives with the server's own record.
 */
export class ServerSessionRecaps {
  constructor(private readonly deps: ServerSessionRecapsDeps) {}

  owns(session: LiveSession): boolean {
    return serverOf(session) !== null
  }

  view(session: LiveSession, look: boolean): Promise<SessionRecapView> {
    return this.ask(session, 'sessionRecap.get', { look }, READ_TIMEOUT_MS)
  }

  refresh(session: LiveSession): Promise<SessionRecapView> {
    return this.ask(session, 'sessionRecap.refresh', {}, REFRESH_TIMEOUT_MS)
  }

  mark(
    session: LiveSession,
    itemId: string,
    mark: RecapItemMark | null
  ): Promise<SessionRecapView> {
    return this.ask(session, 'sessionRecap.mark', { itemId, mark }, READ_TIMEOUT_MS)
  }

  /** The server's answer about the session, under the id this host lists it by. */
  private async ask(
    session: LiveSession,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<SessionRecapView> {
    const server = serverOf(session)
    const sessionId = serverSessionId(session.machine.hostId, session.id)
    if (!server || !sessionId) {
      return unanswered(session.id)
    }
    let message: string | null = null
    const reply = await this.deps
      .call(server, method, { ...params, sessionId }, timeoutMs)
      .catch((error: unknown) => {
        message = error instanceof Error ? error.message : null
        return null
      })
    const parsed = sessionRecapViewSchema.safeParse(reply)
    return parsed.success
      ? { ...judgedOnly(parsed.data), sessionId: session.id }
      : unanswered(session.id, message)
  }
}
