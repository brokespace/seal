import {
  RECAP_SECTIONS,
  type RecapItem,
  type RecapMarks,
  type RecapReference,
  type RecapSection,
  type SessionRecap
} from '../../shared/session-recap/session-recap-types'
import { RECAP_ITEM_MAX_CHARS, recapLine, type RecapDelta } from './session-recap-delta'
import type { RecapEntry } from './session-recap-transcript'

const SECTION_CAPS: Record<RecapSection, number> = {
  asked: 40,
  did: 40,
  questions: 15,
  ignored: 15,
  actions: 20,
  decisions: 20
}
const ID_PREFIX: Record<RecapSection, string> = {
  asked: 'a',
  did: 'w',
  questions: 'q',
  ignored: 'i',
  actions: 't',
  decisions: 'd'
}
/** What the model may strike off: things that were waiting on someone. */
const RESOLVABLE: readonly RecapSection[] = ['questions', 'ignored', 'actions']
const MAX_REFERENCES = 40
export const RECAP_TITLE_HOLD_MS = 10 * 60_000
const TITLE_NOISE = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'that',
  'this',
  'session',
  'agent',
  'work',
  'task'
])

function sameText(a: string, b: string): boolean {
  const plain = (text: string): string =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  return plain(a) === plain(b)
}

function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      // A crude stem, so "fixing" and "fixes" count as the word "fix" both times.
      .map((word) => word.replace(/(?:ing|ed|es|s)$/, ''))
      .filter((word) => word.length >= 3 && !TITLE_NOISE.has(word))
  )
}

/**
 * Whether a proposed title replaces the current one. A rephrasing (half or more of the shorter
 * title's words shared) never does, and nothing does within the hold after the last change.
 */
export function acceptsRecapTitle(
  current: string | null,
  proposed: string,
  changedAt: number | null,
  now: number
): boolean {
  if (current === null) {
    return true
  }
  if (changedAt !== null && now - changedAt < RECAP_TITLE_HOLD_MS) {
    return false
  }
  const had = titleWords(current)
  const next = titleWords(proposed)
  if (had.size === 0 || next.size === 0) {
    return !sameText(current, proposed) && had.size === 0
  }
  const shared = [...next].filter((word) => had.has(word)).length
  return shared / Math.min(had.size, next.size) < 0.5
}

/** Oldest out first; finished work goes before work still open. */
function capped(section: RecapSection, items: RecapItem[]): RecapItem[] {
  const over = items.length - SECTION_CAPS[section]
  if (over <= 0) {
    return items
  }
  if (section !== 'did') {
    return items.slice(over)
  }
  const dropped = new Set(
    items
      .filter((item) => item.state === 'done')
      .slice(0, over)
      .map((item) => item.id)
  )
  const kept = items.filter((item) => !dropped.has(item.id))
  return kept.slice(Math.max(0, kept.length - SECTION_CAPS[section]))
}

export type RecapMergeContext = {
  now: number
  /** The `m#` tag each message of this chunk went to the model under. */
  refs: ReadonlyMap<string, string>
}

/** The recap after one pass's changes. Items the delta does not name are returned untouched. */
export function applyRecapDelta(
  recap: SessionRecap,
  delta: RecapDelta,
  { now, refs }: RecapMergeContext
): SessionRecap {
  const resolved = new Set(delta.resolve)
  const updates = new Map(delta.update.map((update) => [update.id, update]))
  let nextItemId = recap.nextItemId
  const sections = Object.fromEntries(
    RECAP_SECTIONS.map((section) => {
      const kept = recap[section]
        .filter((item) => !(RESOLVABLE.includes(section) && resolved.has(item.id)))
        .map((item) => {
          const update = updates.get(item.id)
          if (!update) {
            return item
          }
          return {
            ...item,
            ...(update.text ? { text: update.text } : {}),
            ...(section === 'did' && update.state ? { state: update.state } : {})
          }
        })
      for (const added of delta.add[section]) {
        if (kept.some((item) => sameText(item.text, added.text))) {
          continue
        }
        kept.push({
          id: `${ID_PREFIX[section]}${nextItemId++}`,
          text: added.text,
          messageId: (added.ref && refs.get(added.ref)) || null,
          at: now,
          ...(section === 'did' ? { state: added.state ?? 'done' } : {})
        })
      }
      return [section, capped(section, kept)]
    })
  )
  const retitled =
    delta.title !== null &&
    delta.title !== recap.title &&
    acceptsRecapTitle(recap.title, delta.title, recap.titleChangedAt, now)
  return {
    ...recap,
    ...sections,
    title: retitled ? delta.title : recap.title,
    titleChangedAt: retitled ? now : recap.titleChangedAt,
    goal: delta.goal ?? recap.goal,
    standing: delta.standing ?? recap.standing,
    nextItemId,
    updatedAt: now
  }
}

/** New files and links on the recap, one per target, newest kept. */
export function addRecapReferences(
  recap: SessionRecap,
  found: readonly Omit<RecapReference, 'at'>[],
  now: number
): SessionRecap {
  const known = new Set(recap.references.map((reference) => reference.target))
  const references = [...recap.references]
  for (const reference of found) {
    if (!known.has(reference.target)) {
      known.add(reference.target)
      references.push({ ...reference, at: now })
    }
  }
  return { ...recap, references: references.slice(-MAX_REFERENCES) }
}

/** What the host can say without the model: each of the user's messages, by its first line. */
export function recapFallbackDelta(
  entries: readonly RecapEntry[],
  refOf: (entry: RecapEntry) => string
): RecapDelta {
  return {
    title: null,
    goal: null,
    standing: null,
    add: {
      asked: entries
        .filter((entry) => entry.role === 'user')
        .map((entry) => ({
          text: recapLine(entry.text.split('\n')[0] ?? '', RECAP_ITEM_MAX_CHARS),
          ref: refOf(entry)
        }))
        .filter((item) => item.text.length > 0),
      did: [],
      questions: [],
      ignored: [],
      actions: [],
      decisions: []
    },
    update: [],
    resolve: []
  }
}

/** Ticks that still name an item, plus those a rebuilt recap carries over by an item's text. */
export function carryRecapMarks(
  marks: RecapMarks,
  before: SessionRecap | null,
  after: SessionRecap
): RecapMarks {
  const next: RecapMarks = {}
  for (const section of RECAP_SECTIONS) {
    for (const item of after[section]) {
      const twin = before?.[section].find((old) => sameText(old.text, item.text))
      const mark = marks[item.id] ?? (twin ? marks[twin.id] : undefined)
      if (mark) {
        next[item.id] = mark
      }
    }
  }
  return next
}
