import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import { sessionSuccessor } from './session-succession'

export type PublishedSessionChange =
  | { type: 'upsert'; session: LiveSession }
  | { type: 'remove'; sessionId: string; replacedBy?: string }

/** What the registry last told its consumers, and the ids sessions went by before. */
export class PublishedSessions {
  private readonly published = new Map<string, { session: LiveSession; json: string }>()
  /** Ids a session had before its agent named it: a fresh agent is `pid-<pid>` until its first prompt. */
  private readonly renamed = new Map<string, string>()

  list(): LiveSession[] {
    return [...this.published.values()].map((entry) => entry.session)
  }

  get(sessionId: string): LiveSession | null {
    return this.published.get(this.currentId(sessionId))?.session ?? null
  }

  /** The id a session goes by now, following its renames. */
  currentId(sessionId: string): string {
    let id = sessionId
    for (let hops = 0; hops < 8 && this.renamed.has(id); hops++) {
      id = this.renamed.get(id)!
    }
    return id
  }

  /** Takes the sessions as they are now; returns what changed, in the order consumers apply it. */
  replace(sessions: readonly LiveSession[]): PublishedSessionChange[] {
    const changes: PublishedSessionChange[] = []
    const seen = new Set<string>()
    for (const session of sessions) {
      if (seen.has(session.id)) {
        continue
      }
      seen.add(session.id)
      const json = JSON.stringify(session)
      if (this.published.get(session.id)?.json !== json) {
        this.published.set(session.id, { session, json })
        changes.push({ type: 'upsert', session })
      }
    }
    for (const [sessionId, { session: gone }] of this.published) {
      if (seen.has(sessionId)) {
        continue
      }
      this.published.delete(sessionId)
      const successor = sessionSuccessor(gone, sessions)
      if (successor) {
        this.renamed.set(sessionId, successor.id)
      }
      changes.push({
        type: 'remove',
        sessionId,
        ...(successor ? { replacedBy: successor.id } : {})
      })
    }
    return changes
  }
}
