import type {
  LiveSession,
  LiveSessionRegistryEvent
} from '../../shared/live-sessions/live-session-types'
import { recapTurnHasEnded } from '../../shared/session-recap/session-recap-request-display'
import type {
  RecapItemMark,
  SessionRecap,
  SessionRecapView
} from '../../shared/session-recap/session-recap-types'
import type { ServerSessionRecaps } from './server-session-recaps'
import type { SessionRecapEngine } from './session-recap-engine'
import { RecapPassSchedule, type RecapPassScheduleDeps } from './session-recap-pass-schedule'
import { recapBrief, recapViewState, shownRecap } from './session-recap-shown'
import type { SessionRecapStore } from './session-recap-store'

export type LiveSessionRecapsDeps = Omit<RecapPassScheduleDeps, 'engine'> & {
  engine: Pick<SessionRecapEngine, 'update' | 'isUpdating' | 'failure' | 'forget'>
  store: SessionRecapStore
  /** The session's conversation can be read here: a transcript file, or a chat's journal. */
  readable: (session: LiveSession) => boolean
  /** Paired servers' own recaps. Absent on a host that reaches no server, and on a server itself. */
  server?: Pick<ServerSessionRecaps, 'owns' | 'view' | 'refresh' | 'mark'>
}

/** Recaps for the registry's sessions: when each is brought up to date, and what clients read. */
export class LiveSessionRecaps {
  private readonly schedule: RecapPassSchedule

  constructor(private readonly deps: LiveSessionRecapsDeps) {
    this.schedule = new RecapPassSchedule(deps)
  }

  observe(event: LiveSessionRegistryEvent): void {
    if (event.type === 'remove') {
      this.schedule.forget(event.sessionId)
      this.deps.engine.forget(event.sessionId)
      if (event.replacedBy) {
        this.deps.store.move(event.sessionId, event.replacedBy)
      }
      return
    }
    if (event.type !== 'upsert') {
      return
    }
    const { session } = event
    if (this.deps.server?.owns(session)) {
      // One recap per session: the server that runs it makes it, and this host only shows it.
      this.schedule.forget(session.id)
      return
    }
    if (!this.deps.readable(session)) {
      this.schedule.unreadable(session.id)
    } else if (recapTurnHasEnded(session.status)) {
      this.schedule.turnEnded(session)
    } else if (session.alive) {
      this.schedule.turnRuns(session)
    }
  }

  /** The utility model came back: sessions that stopped while it was away are due again. */
  resume(): void {
    this.schedule.resume()
  }

  /** The session as clients see it: its recap title and what is still open for the user. */
  decorate(session: LiveSession): LiveSession {
    if (this.deps.server?.owns(session)) {
      // Its server's record already carries the brief of the recap that server keeps.
      return session
    }
    if (!this.deps.enabled()) {
      return session
    }
    const stored = this.deps.store.get(session.id)
    const updating = this.deps.engine.isUpdating(session.id)
    const recap = stored?.recap ?? null
    const shown =
      recap &&
      shownRecap(recap, {
        turnEnded: recapTurnHasEnded(session.status),
        stale: this.behind(session, recap)
      })
    const brief = recapBrief(shown, stored?.marks ?? {}, stored?.rev ?? 0, updating)
    return brief ? { ...session, recap: brief } : session
  }

  /** What a client draws. `look` is the user opening it: a visit, and a pass when it is out of date. */
  view(sessionId: string, look: boolean): SessionRecapView {
    const session = this.deps.session(sessionId)
    const id = session?.id ?? sessionId
    const since =
      look && this.deps.enabled()
        ? this.deps.store.look(id, this.deps.now?.() ?? Date.now())
        : (this.deps.store.get(id)?.previousLookedAt ?? null)
    const stored = this.deps.store.get(id)
    const recap = stored?.recap ?? null
    const stale = session !== null && recap !== null && this.behind(session, recap)
    const turnEnded = session !== null && recapTurnHasEnded(session.status)
    if (
      look &&
      (stale || recap === null) &&
      session &&
      this.deps.readable(session) &&
      this.schedule.available() &&
      !this.deps.engine.isUpdating(id) &&
      this.schedule.mayStartOnOpening(id, turnEnded)
    ) {
      void this.schedule.ask(id, false)
    }
    // Read after the pass started: its outcome is what the state reports.
    const outcome = this.schedule.outcome(id)
    return {
      sessionId: id,
      recap: recap && shownRecap(recap, { turnEnded, stale }),
      marks: stored?.marks ?? {},
      since,
      state: recapViewState({
        enabled: this.deps.enabled(),
        updating: this.deps.engine.isUpdating(id),
        hasRecap: recap !== null,
        stale,
        paused: this.deps.pausedUntil() !== null,
        failed: outcome === 'failed' && Boolean(this.deps.engine.failure(id)),
        overBudget: outcome === 'over-budget'
      }),
      stale,
      pausedUntil: this.deps.pausedUntil(),
      failure: this.deps.engine.failure(id),
      rev: stored?.rev ?? 0,
      turnEnded
    }
  }

  /** `view` for any session: one a paired server keeps is read from that server. */
  async get(sessionId: string, look: boolean): Promise<SessionRecapView> {
    const owned = this.serverOwned(sessionId)
    return owned ? owned.server.view(owned.session, look) : this.view(sessionId, look)
  }

  /** A pass now; with nothing new to read, the recap is rebuilt from the recent history. */
  async refresh(sessionId: string): Promise<SessionRecapView> {
    const session = this.deps.session(sessionId)
    const owned = this.serverOwned(sessionId)
    if (owned) {
      return owned.server.refresh(owned.session)
    }
    const id = session?.id ?? sessionId
    if (this.deps.enabled() && session && this.deps.readable(session)) {
      if ((await this.schedule.ask(id, false)) === 'current') {
        await this.schedule.ask(id, true)
      }
    }
    return this.view(id, false)
  }

  mark(sessionId: string, itemId: string, mark: RecapItemMark | null): SessionRecapView {
    const id = this.deps.session(sessionId)?.id ?? sessionId
    this.deps.store.mark(id, itemId, mark)
    return this.view(id, false)
  }

  /** `mark` for any session: one a paired server keeps is marked on that server. */
  async setMark(
    sessionId: string,
    itemId: string,
    mark: RecapItemMark | null
  ): Promise<SessionRecapView> {
    const owned = this.serverOwned(sessionId)
    return owned
      ? owned.server.mark(owned.session, itemId, mark)
      : this.mark(sessionId, itemId, mark)
  }

  dispose(): void {
    this.schedule.dispose()
  }

  private serverOwned(
    sessionId: string
  ): { server: NonNullable<LiveSessionRecapsDeps['server']>; session: LiveSession } | null {
    const { server } = this.deps
    const session = this.deps.session(sessionId)
    return server && session && server.owns(session) ? { server, session } : null
  }

  /**
   * The transcript moved after the recap was last written and after the last pass read it. A pass
   * that found nothing to say leaves the recap as it was, and the recap is not behind for that.
   */
  private behind(session: LiveSession, recap: SessionRecap): boolean {
    return session.lastActivityAt > Math.max(recap.updatedAt, this.schedule.readThrough(session.id))
  }
}
