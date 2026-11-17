import * as z from 'zod'
import {
  RECAP_ITEM_MARKS,
  RECAP_REFERENCE_KINDS,
  RECAP_REQUEST_STATUSES,
  RECAP_WORK_STATES,
  SESSION_RECAP_STATES,
  SESSION_RECAP_VERSION,
  type LiveSessionRecapBrief,
  type RecapItem,
  type RecapReference,
  type RecapRequest,
  type SessionRecap,
  type SessionRecapView
} from './session-recap-types'

const Timestamp = z.number().finite()

const recapItemSchema: z.ZodType<RecapItem> = z.object({
  id: z.string().min(1),
  text: z.string(),
  messageId: z.string().nullable(),
  at: Timestamp,
  state: z.enum(RECAP_WORK_STATES).optional()
})

const recapReferenceSchema: z.ZodType<RecapReference> = z.object({
  kind: z.enum(RECAP_REFERENCE_KINDS),
  label: z.string(),
  target: z.string(),
  messageId: z.string().nullable(),
  at: Timestamp
})

const items = z.array(recapItemSchema)

const Probability = z.number().min(0).max(1)

const recapRequestSchema: z.ZodType<RecapRequest> = z.object({
  id: z.string().min(1),
  text: z.string(),
  messageId: z.string().nullable(),
  offset: z.number().nonnegative().optional(),
  at: Timestamp,
  status: z.enum(RECAP_REQUEST_STATUSES),
  statusAt: Timestamp,
  judged: z
    .object({
      at: Timestamp,
      coveredTo: z.number().nonnegative(),
      model: z.string(),
      questionBook: z.string(),
      answers: z.object({
        done: Probability,
        did_part: Probability,
        declined: Probability,
        withdrawn: Probability,
        left_undone: Probability
      }),
      leftUndone: z.boolean(),
      turnEnded: z.boolean(),
      complete: z.boolean()
    })
    .optional()
})

/** A recap as it is saved and as a client reads it. One of another version does not parse. */
export const sessionRecapSchema: z.ZodType<SessionRecap> = z.object({
  version: z.literal(SESSION_RECAP_VERSION),
  title: z.string().nullable(),
  titleChangedAt: Timestamp.nullable(),
  goal: z.string().nullable(),
  standing: z.string().nullable(),
  asked: items,
  did: items,
  questions: items,
  ignored: items,
  actions: items,
  decisions: items,
  references: z.array(recapReferenceSchema),
  updatedAt: Timestamp,
  coveredFrom: z.number().nonnegative(),
  coveredTo: z.number().nonnegative(),
  nextItemId: z.number().int().positive(),
  requests: z.array(recapRequestSchema).optional(),
  degraded: z.literal(true).optional(),
  anchor: z.object({ sessionId: z.string().min(1), at: Timestamp }).optional()
})

export const recapMarksSchema = z.record(z.string(), z.enum(RECAP_ITEM_MARKS))

export const sessionRecapViewSchema: z.ZodType<SessionRecapView> = z.object({
  sessionId: z.string().min(1),
  recap: sessionRecapSchema.nullable(),
  marks: recapMarksSchema,
  since: Timestamp.nullable(),
  state: z.enum(SESSION_RECAP_STATES),
  stale: z.boolean(),
  pausedUntil: Timestamp.nullable(),
  failure: z.string().nullable(),
  rev: z.number(),
  turnEnded: z.boolean().optional()
})

export const liveSessionRecapBriefSchema: z.ZodType<LiveSessionRecapBrief> = z.object({
  title: z.string().nullable(),
  rev: z.number(),
  questions: z.number(),
  actions: z.number(),
  notAddressed: z.number().optional(),
  updating: z.literal(true).optional()
})
