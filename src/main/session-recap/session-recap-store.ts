import * as z from 'zod'
import {
  recapMarksSchema,
  sessionRecapSchema
} from '../../shared/session-recap/session-recap-schemas'
import {
  RECAP_SECTIONS,
  type RecapItemMark,
  type RecapMarks,
  type SessionRecap
} from '../../shared/session-recap/session-recap-types'
import { LiveSessionJsonStore } from '../live-sessions/live-session-json-store'

export type StoredRecap = {
  sessionId: string
  recap: SessionRecap | null
  /** The user's ticks and dismissals, by item id. */
  marks: RecapMarks
  /** When the user last had the recap open, and the visit before that one. */
  lookedAt: number | null
  previousLookedAt: number | null
  rev: number
}

const storedSchema: z.ZodType<StoredRecap> = z.object({
  sessionId: z.string().min(1),
  recap: sessionRecapSchema.nullable(),
  marks: recapMarksSchema,
  lookedAt: z.number().nullable(),
  previousLookedAt: z.number().nullable(),
  rev: z.number()
})

const isStored = (value: unknown): value is StoredRecap => storedSchema.safeParse(value).success

const MAX_STORED = 300
/** Opening the recap again this soon is the same visit, not a new "last looked". */
export const RECAP_VISIT_GAP_MS = 10 * 60_000

function itemIds(recap: SessionRecap | null): Set<string> {
  return new Set(
    recap ? RECAP_SECTIONS.flatMap((section) => recap[section].map((item) => item.id)) : []
  )
}

/** Recaps and what the user ticked on them, kept across restarts and across a session's resume. */
export class SessionRecapStore {
  private readonly file: LiveSessionJsonStore<StoredRecap>
  private readonly bySession = new Map<string, StoredRecap>()
  private loading: Promise<void> | null = null

  constructor(path: string, log?: (message: string, error?: unknown) => void) {
    this.file = new LiveSessionJsonStore(path, isStored, log)
  }

  load(): Promise<void> {
    this.loading ??= this.file.load().then((saved) => {
      for (const stored of saved) {
        // What was written while the file loaded is newer than the file.
        if (!this.bySession.has(stored.sessionId)) {
          this.bySession.set(stored.sessionId, stored)
        }
      }
    })
    return this.loading
  }

  flush(): Promise<void> {
    return this.file.flush()
  }

  get(sessionId: string): StoredRecap | null {
    return this.bySession.get(sessionId) ?? null
  }

  /** Saves a pass's result; ticks on items the recap no longer holds go with them. */
  setRecap(sessionId: string, recap: SessionRecap, marks: RecapMarks): StoredRecap {
    const ids = itemIds(recap)
    return this.put(sessionId, {
      recap,
      marks: Object.fromEntries(Object.entries(marks).filter(([id]) => ids.has(id)))
    })
  }

  /** Ticks or dismisses an item; null clears it. False when the recap has no such item. */
  mark(sessionId: string, itemId: string, mark: RecapItemMark | null): boolean {
    const stored = this.bySession.get(sessionId)
    if (!stored || !itemIds(stored.recap).has(itemId)) {
      return false
    }
    const { [itemId]: had, ...rest } = stored.marks
    if ((had ?? null) === mark) {
      return true
    }
    this.put(sessionId, { marks: mark ? { ...rest, [itemId]: mark } : rest })
    return true
  }

  /** Records a visit and returns the one before it, which "since you last looked" measures from. */
  look(sessionId: string, now: number): number | null {
    const stored = this.bySession.get(sessionId)
    const newVisit =
      stored?.lookedAt != null && now - stored.lookedAt > RECAP_VISIT_GAP_MS
        ? { previousLookedAt: stored.lookedAt }
        : {}
    // A visit is the user's own state: it does not raise `rev`, so nothing refetches over it.
    const next = this.put(sessionId, { ...newVisit, lookedAt: now }, false)
    return next.previousLookedAt
  }

  /** A resumed session keeps its recap under its new id. */
  move(from: string, to: string): void {
    const stored = this.bySession.get(from)
    if (!stored || this.bySession.has(to)) {
      return
    }
    this.bySession.delete(from)
    this.bySession.set(to, { ...stored, sessionId: to })
    this.save()
  }

  forget(sessionIds: readonly string[]): void {
    let changed = false
    for (const id of sessionIds) {
      changed = this.bySession.delete(id) || changed
    }
    if (changed) {
      this.save()
    }
  }

  private put(sessionId: string, patch: Partial<StoredRecap>, bump = true): StoredRecap {
    const had = this.bySession.get(sessionId) ?? {
      sessionId,
      recap: null,
      marks: {},
      lookedAt: null,
      previousLookedAt: null,
      rev: 0
    }
    const next = { ...had, ...patch, sessionId, rev: had.rev + (bump ? 1 : 0) }
    // Re-inserted so the map's order is least recently written first.
    this.bySession.delete(sessionId)
    this.bySession.set(sessionId, next)
    for (const oldest of this.bySession.keys()) {
      if (this.bySession.size <= MAX_STORED) {
        break
      }
      this.bySession.delete(oldest)
    }
    this.save()
    return next
  }

  private save(): void {
    this.file.save([...this.bySession.values()])
  }
}
