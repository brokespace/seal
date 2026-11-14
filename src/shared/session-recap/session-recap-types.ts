// Session recap: a rolling overview of one agent session, made on the host that owns the registry.
// Plain JSON, shared by main, the runtime RPC, the renderer and mobile. See docs/session-recap.md.

export const SESSION_RECAP_VERSION = 1

export const RECAP_WORK_STATES = ['done', 'in-progress', 'blocked'] as const
export type RecapWorkState = (typeof RECAP_WORK_STATES)[number]

/** The sections whose items the model writes. */
export const RECAP_SECTIONS = [
  'asked',
  'did',
  'questions',
  'ignored',
  'actions',
  'decisions'
] as const
export type RecapSection = (typeof RECAP_SECTIONS)[number]

export type RecapItem = {
  /** Given by the host and kept for the item's life, so a tick survives the next pass. */
  id: string
  text: string
  /** The transcript message it came from; null when the model named none. */
  messageId: string | null
  /** When it entered the recap, which is what "since you last looked" compares. */
  at: number
  /** On work items only. */
  state?: RecapWorkState
}

export const RECAP_REFERENCE_KINDS = ['file', 'pr', 'link'] as const
export type RecapReferenceKind = (typeof RECAP_REFERENCE_KINDS)[number]

export type RecapReference = {
  kind: RecapReferenceKind
  label: string
  /** A path or URL; one reference per target. */
  target: string
  messageId: string | null
  at: number
}

export type SessionRecap = { version: typeof SESSION_RECAP_VERSION } & Record<
  RecapSection,
  RecapItem[]
> & {
    title: string | null
    titleChangedAt: number | null
    goal: string | null
    standing: string | null
    references: RecapReference[]
    updatedAt: number
    /** Transcript byte offset the recap starts at; above 0 when older history was left out. */
    coveredFrom: number
    /** Transcript byte offset read so far: the next pass starts here. */
    coveredTo: number
    nextItemId: number
    /** The last pass could not use the model's reply and kept only what the host reads itself. */
    degraded?: true
  }

export const RECAP_ITEM_MARKS = ['done', 'dismissed'] as const
/** What the user did with an open question or action item. */
export type RecapItemMark = (typeof RECAP_ITEM_MARKS)[number]
export type RecapMarks = Record<string, RecapItemMark>

/** Why there is no fresh recap; `ready` when there is. */
export const SESSION_RECAP_STATES = [
  'ready',
  /** A pass is running. */
  'updating',
  /** Nothing in the transcript to recap yet. */
  'empty',
  /** Recaps are off, or this host has no utility model. */
  'unavailable',
  /** Held after a rate limit until `pausedUntil`. */
  'paused',
  /** Today's share of the free allocation is used. */
  'over-budget',
  'failed'
] as const
export type SessionRecapState = (typeof SESSION_RECAP_STATES)[number]

/** What a client draws for one session. */
export type SessionRecapView = {
  sessionId: string
  recap: SessionRecap | null
  marks: RecapMarks
  /** The visit before this one; null on a first visit. */
  since: number | null
  state: SessionRecapState
  /** The transcript has moved past what the recap covers. */
  stale: boolean
  pausedUntil: number | null
  /** The provider's reason when `failed`; never holds a credential. */
  failure: string | null
  rev: number
}

/** What every session row carries, so labels and badges need no fetch. */
export type LiveSessionRecapBrief = {
  title: string | null
  /** Rises on every change to the recap or its ticks; a client with an older one reads again. */
  rev: number
  /** Open questions and action items the user has neither ticked nor dismissed. */
  questions: number
  actions: number
  updating?: true
}

export function emptySessionRecap(now: number): SessionRecap {
  return {
    version: SESSION_RECAP_VERSION,
    title: null,
    titleChangedAt: null,
    goal: null,
    standing: null,
    asked: [],
    did: [],
    questions: [],
    ignored: [],
    actions: [],
    decisions: [],
    references: [],
    updatedAt: now,
    coveredFrom: 0,
    coveredTo: 0,
    nextItemId: 1
  }
}

/** Items still on the user: open questions and action items without a tick or a dismissal. */
export function openRecapItems(items: readonly RecapItem[], marks: RecapMarks): RecapItem[] {
  return items.filter((item) => marks[item.id] === undefined)
}
