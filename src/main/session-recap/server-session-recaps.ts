import {
  isSettledLiveSessionStatus,
  isTurnRunningLiveSessionStatus
} from '../../shared/live-sessions/live-session-status'
import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import { recapTurnHasEnded } from '../../shared/session-recap/session-recap-request-display'
import { sessionRecapViewSchema } from '../../shared/session-recap/session-recap-schemas'
import type {
  LiveSessionRecapBrief,
  RecapItemMark,
  SessionRecapView
} from '../../shared/session-recap/session-recap-types'
import { liveSessionId } from '../live-sessions/discovery/session-assembly'
import { LOCAL_HOST_ID } from '../live-sessions/hosts/live-session-hosts'
import { serverOf } from '../session-summaries/server-session-summaries'
import type { ServerSessionRecapsSource } from './server-session-recaps-source'
import { recapBrief } from './session-recap-shown'

export type ServerSessionRecapsDeps = {
  /** A paired Seal server's answer to a runtime call; null when it could not answer. */
  call: (
    executionHostId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown | null>
  /** A row's brief changed: the registry should publish its sessions again. */
  onChange: () => void
  setTimer: (run: () => void, delayMs: number) => { cancel: () => void }
  now: () => number
}

type Entry = {
  server: string
  session: LiveSession
  brief: LiveSessionRecapBrief | null
  /** The stop or activity last read for, so a republished row asks nothing. */
  stamp: string | null
  fetchedAt: number
  fetching: boolean
  /** Follow-up reads already spent on a recap the server has yet to finish. */
  followUps: number
  followUp: { cancel: () => void } | null
}

const READ_TIMEOUT_MS = 15_000
/** As long as a client waits for its own Refresh: a rebuild is several model calls. */
const REFRESH_TIMEOUT_MS = 6 * 60_000
const STOPPED_REFRESH_MS = 3_000
/** A session at work is recapped minutes apart, so its brief is read no closer than this. */
const WORKING_REFRESH_MS = 60_000
/** The server recaps seconds after a stop, or up to four minutes on when it has just made a pass. */
const FOLLOW_UP_DELAYS_MS = [
  3_500, 3_500, 7_000, 15_000, 30_000, 60_000, 60_000, 60_000, 30_000, 30_000, 30_000
]

/** The id the server's own registry gives the session, which runs on its local machine. */
function serverSessionId(session: LiveSession): string {
  return liveSessionId(LOCAL_HOST_ID, session.provider, session.providerSessionId)
}

function unanswered(sessionId: string): SessionRecapView {
  return {
    sessionId,
    recap: null,
    marks: {},
    since: null,
    state: 'failed',
    stale: false,
    pausedUntil: null,
    failure: 'The server that runs this session did not answer',
    rev: 0
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

function sameBrief(a: LiveSessionRecapBrief | null, b: LiveSessionRecapBrief | null): boolean {
  if (a === null || b === null) {
    return a === b
  }
  return (
    a.title === b.title &&
    a.rev === b.rev &&
    a.questions === b.questions &&
    a.actions === b.actions &&
    a.notAddressed === b.notAddressed &&
    a.updating === b.updating
  )
}

/** The server has a pass running, or owes one for a stop its recap does not cover yet. */
function recapOnItsWay(view: SessionRecapView, session: LiveSession): boolean {
  if (view.state === 'updating') {
    return true
  }
  const owed = view.recap ? view.stale && view.state === 'ready' : view.state === 'empty'
  return owed && session.alive && isSettledLiveSessionStatus(session.status)
}

/**
 * The recaps paired servers keep for the sessions they run, which this host shows as they are. A
 * session has one recap, made by the host that runs it: this host makes none for these sessions,
 * whether or not their server can.
 */
export class ServerSessionRecaps implements ServerSessionRecapsSource {
  private readonly sessions = new Map<string, Entry>()

  constructor(private readonly deps: ServerSessionRecapsDeps) {}

  owns(session: LiveSession): boolean {
    return serverOf(session) !== null
  }

  brief(session: LiveSession): LiveSessionRecapBrief | null {
    const brief = this.sessions.get(session.id)?.brief ?? null
    if (!brief?.notAddressed || recapTurnHasEnded(session.status)) {
      return brief
    }
    // This host saw the next turn start before the server's answer said so.
    const { title, rev, questions, actions, updating } = brief
    return { title, rev, questions, actions, ...(updating ? { updating } : {}) }
  }

  observe(session: LiveSession): void {
    const server = serverOf(session)
    if (!server) {
      return
    }
    const now = this.deps.now()
    const entry = this.track(session, server)
    const stamp = `${session.status}:${session.lastActivityAt}`
    if (entry.stamp === stamp) {
      return
    }
    entry.stamp = stamp
    entry.followUps = 0
    if (isTurnRunningLiveSessionStatus(session.status)) {
      if (now - entry.fetchedAt >= WORKING_REFRESH_MS) {
        this.fetch(entry)
      }
    } else if (entry.fetching || now - entry.fetchedAt < STOPPED_REFRESH_MS) {
      this.followUpLater(entry)
    } else {
      this.fetch(entry)
    }
  }

  forget(sessionId: string): void {
    this.sessions.get(sessionId)?.followUp?.cancel()
    this.sessions.delete(sessionId)
  }

  view(session: LiveSession, look: boolean): Promise<SessionRecapView> {
    return this.read(session, 'sessionRecap.get', { look }, READ_TIMEOUT_MS)
  }

  refresh(session: LiveSession): Promise<SessionRecapView> {
    return this.read(session, 'sessionRecap.refresh', {}, REFRESH_TIMEOUT_MS)
  }

  mark(
    session: LiveSession,
    itemId: string,
    mark: RecapItemMark | null
  ): Promise<SessionRecapView> {
    return this.read(session, 'sessionRecap.mark', { itemId, mark }, READ_TIMEOUT_MS)
  }

  dispose(): void {
    for (const entry of this.sessions.values()) {
      entry.followUp?.cancel()
    }
    this.sessions.clear()
  }

  private track(session: LiveSession, server: string): Entry {
    let entry = this.sessions.get(session.id)
    if (!entry) {
      entry = {
        server,
        session,
        brief: null,
        stamp: null,
        fetchedAt: 0,
        fetching: false,
        followUps: 0,
        followUp: null
      }
      this.sessions.set(session.id, entry)
    }
    entry.session = session
    return entry
  }

  private ask(
    session: LiveSession,
    server: string,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<unknown | null> {
    return this.deps
      .call(server, method, { ...params, sessionId: serverSessionId(session) }, timeoutMs)
      .catch(() => null)
  }

  /** A client's own read, tick or Refresh, answered by the server under this host's session id. */
  private async read(
    session: LiveSession,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<SessionRecapView> {
    const server = serverOf(session)
    if (!server) {
      return unanswered(session.id)
    }
    // Opening a recap can start a pass on the server: its end is watched for from the start.
    this.track(session, server).followUps = 0
    return this.answered(session, await this.ask(session, server, method, params, timeoutMs))
  }

  private fetch(entry: Entry): void {
    if (entry.fetching) {
      return
    }
    entry.fetching = true
    entry.fetchedAt = this.deps.now()
    const { session, server } = entry
    void this.ask(session, server, 'sessionRecap.get', { look: false }, READ_TIMEOUT_MS).then(
      (reply) => {
        entry.fetching = false
        if (this.sessions.get(session.id) === entry) {
          this.answered(entry.session, reply)
        }
      }
    )
  }

  private answered(session: LiveSession, reply: unknown): SessionRecapView {
    const parsed = sessionRecapViewSchema.safeParse(reply)
    if (!parsed.success) {
      return unanswered(session.id)
    }
    const view = judgedOnly(parsed.data)
    const entry = this.sessions.get(session.id)
    if (entry) {
      const watched = recapOnItsWay(view, entry.session) && this.followUpLater(entry)
      // A pass nobody will look in on again must not leave the row updating for good.
      const updating = view.state === 'updating' && watched
      this.show(entry, recapBrief(view.recap, view.marks, view.rev, updating))
    }
    return { ...view, sessionId: session.id }
  }

  private show(entry: Entry, brief: LiveSessionRecapBrief | null): void {
    const changed = !sameBrief(entry.brief, brief)
    entry.brief = brief
    if (changed) {
      this.deps.onChange()
    }
  }

  /** Reads the session again in a while; false once its follow-ups are spent. */
  private followUpLater(entry: Entry): boolean {
    if (entry.followUp) {
      return true
    }
    const delay = FOLLOW_UP_DELAYS_MS.at(entry.followUps)
    if (delay === undefined) {
      return false
    }
    entry.followUps += 1
    entry.followUp = this.deps.setTimer(() => {
      entry.followUp = null
      this.fetch(entry)
    }, delay)
    return true
  }
}
