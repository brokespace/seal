import type {
  LiveSession,
  LiveSessionAnnotation,
  LiveSessionProject
} from '../../shared/live-sessions/live-session-types'
import { LiveSessionJsonStore } from './live-session-json-store'

type Saved = {
  sessionId: string
  customTitle?: string
  pinned?: boolean
  project?: LiveSessionProject
}

function isSaved(item: unknown): item is Saved {
  return (
    typeof item === 'object' &&
    item !== null &&
    'sessionId' in item &&
    typeof item.sessionId === 'string'
  )
}

/** What the user set on a session in Seal (its name, its pin, its project); kept across rescans and restarts. */
export class LiveSessionAnnotations {
  private readonly bySession = new Map<string, Saved>()
  private readonly store: LiveSessionJsonStore<Saved>
  private loading: Promise<void> | null = null

  constructor(path: string, log?: (message: string, error?: unknown) => void) {
    this.store = new LiveSessionJsonStore(path, isSaved, log)
  }

  load(): Promise<void> {
    this.loading ??= this.store.load().then((items) => {
      for (const item of items) {
        this.bySession.set(item.sessionId, item)
      }
    })
    return this.loading
  }

  apply(session: LiveSession): LiveSession {
    // A session resumed into a new transcript while Seal was closed is still found by its old id.
    const earlier = session.continues?.find((id) => this.bySession.has(id))
    const saved = this.bySession.get(session.id) ?? (earlier ? this.bySession.get(earlier) : null)
    if (!saved) {
      return session
    }
    return {
      ...session,
      ...(saved.customTitle ? { customTitle: saved.customTitle } : {}),
      ...(saved.pinned ? { pinned: true } : {}),
      ...(saved.project ? { assignedProject: saved.project } : {})
    }
  }

  set({ sessionId, customTitle, pinned, project }: LiveSessionAnnotation): void {
    const saved = this.bySession.get(sessionId)
    // Undefined leaves a field as it was; null, blank or false clears it.
    const title = customTitle === undefined ? saved?.customTitle : customTitle?.trim()
    const pin = pinned ?? saved?.pinned
    const name = project?.name.trim()
    const assigned =
      project === undefined ? saved?.project : project && name ? { key: project.key, name } : null
    if (title || pin || assigned) {
      this.bySession.set(sessionId, {
        sessionId,
        ...(title ? { customTitle: title } : {}),
        ...(pin ? { pinned: true } : {}),
        ...(assigned ? { project: assigned } : {})
      })
    } else {
      this.bySession.delete(sessionId)
    }
    this.save()
  }

  /** A session keeps its name, pin and project when its transcript gives it its lasting id. */
  move(fromSessionId: string, toSessionId: string): void {
    const saved = this.bySession.get(fromSessionId)
    if (!saved) {
      return
    }
    this.bySession.delete(fromSessionId)
    this.bySession.set(toSessionId, {
      ...saved,
      ...this.bySession.get(toSessionId),
      sessionId: toSessionId
    })
    this.save()
  }

  forget(sessionIds: readonly string[]): void {
    if (sessionIds.filter((sessionId) => this.bySession.delete(sessionId)).length > 0) {
      this.save()
    }
  }

  flush(): Promise<void> {
    return this.store.flush()
  }

  private save(): void {
    this.store.save([...this.bySession.values()])
  }
}
