import * as z from 'zod'
import {
  RECAP_WORK_STATES,
  type RecapSection,
  type RecapWorkState
} from '../../shared/session-recap/session-recap-types'
import { salvagingArray } from '../../shared/zod-salvage'
import { isRecord } from '../home-chat/home-chat-record-guard'
import { withoutMarkdownMarks } from '../session-summaries/session-summary-text'

export const RECAP_TITLE_MAX_CHARS = 60
export const RECAP_ITEM_MAX_CHARS = 180
export const RECAP_SENTENCE_MAX_CHARS = 320
const MAX_ADDED_PER_SECTION = 12
const MAX_CHANGES = 40

export type RecapDeltaItem = { text: string; ref: string | null; state?: RecapWorkState }

/** The changes one pass makes to a recap. The model never rewrites the recap itself. */
export type RecapDelta = {
  /** Null keeps what the recap has. */
  title: string | null
  goal: string | null
  standing: string | null
  add: Record<RecapSection, RecapDeltaItem[]>
  update: { id: string; text?: string; state?: RecapWorkState }[]
  /** Ids of questions now answered, requests now addressed and action items now done. */
  resolve: string[]
}

export type RecapDeltaResult = { ok: true; delta: RecapDelta } | { ok: false; error: string }

/** One line of plain text, at most `max` characters; empty when nothing is left. */
export function recapLine(value: string, max: number): string {
  const line = withoutMarkdownMarks(value)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '')
    .trim()
  if (line.length <= max) {
    return line
  }
  const cut = line.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, '')}\u2026`
}

const line = (max: number) =>
  z
    .string()
    .transform((value) => recapLine(value, max))
    .refine((value) => value.length > 0)

/** A field the model may leave out, null, or get wrong: all three keep what the recap has. */
const kept = (max: number) => line(max).nullish().catch(null)

const state = z.enum(RECAP_WORK_STATES).optional().catch(undefined)
const ref = z
  .string()
  .transform((value) => value.replace(/^\[|\]$/g, '').trim())
  .nullish()
  .catch(null)

const addedItem = z.object({ text: line(RECAP_ITEM_MAX_CHARS), ref, state })
const added = salvagingArray(addedItem).optional().catch([])

const deltaSchema = z.object({
  title: kept(RECAP_TITLE_MAX_CHARS),
  goal: kept(RECAP_SENTENCE_MAX_CHARS),
  standing: kept(RECAP_SENTENCE_MAX_CHARS),
  add: z
    .object({
      asked: added,
      did: added,
      questions: added,
      ignored: added,
      actions: added,
      decisions: added
    })
    .optional()
    .catch(undefined),
  update: salvagingArray(
    z.object({
      id: z.string().min(1).max(16),
      text: line(RECAP_ITEM_MAX_CHARS).optional().catch(undefined),
      state
    })
  )
    .optional()
    .catch([]),
  resolve: salvagingArray(z.string().min(1).max(16)).optional().catch([])
})

const KNOWN_KEYS = ['title', 'goal', 'standing', 'add', 'update', 'resolve']

/** The JSON object in a reply that may wrap it in a code fence or a sentence. */
function jsonObjectIn(reply: string): string | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  return start !== -1 && end > start ? reply.slice(start, end + 1) : null
}

/**
 * Reads the model's reply as a recap delta. A wrong field or item is dropped on its own; the
 * reply fails only when it is not a JSON object or names nothing a delta holds.
 */
export function parseRecapDelta(reply: string): RecapDeltaResult {
  const json = jsonObjectIn(reply)
  if (json === null) {
    return { ok: false, error: 'The reply holds no JSON object.' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (error) {
    return {
      ok: false,
      error: `The reply is not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`
    }
  }
  if (!isRecord(raw) || !KNOWN_KEYS.some((key) => key in raw)) {
    return {
      ok: false,
      error: `The JSON object has none of the keys ${KNOWN_KEYS.join(', ')}.`
    }
  }
  const parsed = deltaSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) }
  }
  const { title, goal, standing, add, update, resolve } = parsed.data
  const section = (name: RecapSection): RecapDeltaItem[] =>
    (add?.[name] ?? []).slice(0, MAX_ADDED_PER_SECTION).map((item) => ({
      text: item.text,
      ref: item.ref || null,
      ...(name === 'did' ? { state: item.state ?? 'done' } : {})
    }))
  return {
    ok: true,
    delta: {
      title: title ?? null,
      goal: goal ?? null,
      standing: standing ?? null,
      add: {
        asked: section('asked'),
        did: section('did'),
        questions: section('questions'),
        ignored: section('ignored'),
        actions: section('actions'),
        decisions: section('decisions')
      },
      update: (update ?? []).slice(0, MAX_CHANGES),
      resolve: (resolve ?? []).slice(0, MAX_CHANGES)
    }
  }
}
