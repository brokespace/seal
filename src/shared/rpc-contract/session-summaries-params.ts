import { z } from 'zod'
import { UtilityModelChoiceParams } from './utility-model-params'

export const SessionSummariesSetEnabledParams = z.object({ enabled: z.boolean() }).strict()

/** `recaps: null` runs recaps on whatever summaries run on. */
export const SessionSummariesSetModelsParams = z
  .object({ summaries: UtilityModelChoiceParams, recaps: UtilityModelChoiceParams.nullable() })
  .strict()
