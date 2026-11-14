import { z } from 'zod'

export const SessionSummariesSetEnabledParams = z.object({ enabled: z.boolean() }).strict()
