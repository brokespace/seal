import { z } from 'zod'
import { RECAP_ITEM_MARKS } from '../session-recap/session-recap-types'

const SessionId = z.string().min(1).max(4096)

export const SessionRecapGetParams = z
  .object({
    sessionId: SessionId,
    /** The user opened the recap: counts as a visit, and brings a stale recap up to date. */
    look: z.boolean().optional()
  })
  .strict()

export const SessionRecapRefreshParams = z.object({ sessionId: SessionId }).strict()

export const SessionRecapMarkParams = z
  .object({
    sessionId: SessionId,
    itemId: z.string().min(1).max(32),
    /** Null clears the tick or dismissal. */
    mark: z.enum(RECAP_ITEM_MARKS).nullable()
  })
  .strict()

export const SessionRecapSetEnabledParams = z.object({ enabled: z.boolean() }).strict()
