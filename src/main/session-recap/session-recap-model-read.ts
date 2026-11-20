import type { SessionRecap } from '../../shared/session-recap/session-recap-types'
import type { UtilityModelRequest } from '../../shared/utility-model/utility-model-types'
import { parseRecapDelta, type RecapDeltaResult } from './session-recap-delta'
import { applyRecapDelta } from './session-recap-merge'
import { recapPrompt, recapRepairRequest } from './session-recap-prompt'
import {
  attachRecapRequests,
  keepRecapHostRequestIds,
  recapHostRequests
} from './session-recap-request-sources'
import type { RecapEntry } from './session-recap-transcript'

/** One request to the read step's model; `avoid` names models to pass over. */
export type RecapModelCall = (
  request: UtilityModelRequest,
  avoid?: readonly string[]
) => Promise<{ text: string; model: string }>

/**
 * The model's delta for one request. A reply that cannot be read is shown to the model once to
 * repair, and after that the request goes once to the next model, which no service rule can do:
 * only this caller knows the text it got was unusable.
 */
async function askForRecapDelta(
  request: UtilityModelRequest,
  complete: RecapModelCall
): Promise<RecapDeltaResult> {
  const asked: string[] = []
  const attempt = async (avoid?: readonly string[]): Promise<RecapDeltaResult> => {
    const first = await complete(request, avoid)
    asked.push(first.model)
    const parsed = parseRecapDelta(first.text)
    if (parsed.ok) {
      return parsed
    }
    const repair = await complete(recapRepairRequest(request, first.text, parsed.error), avoid)
    asked.push(repair.model)
    return parseRecapDelta(repair.text)
  }
  const parsed = await attempt()
  if (parsed.ok) {
    return parsed
  }
  // No other model, or one that fails: the reply stays unread, which is not a provider failure.
  return attempt([...new Set(asked)]).catch(() => parsed)
}

/** The recap after the model read every chunk; null when its reply to one could not be read. */
export async function readRecapChunks(
  start: SessionRecap,
  chunks: readonly RecapEntry[][],
  options: {
    /** The session's first prompt, for a recap that starts later. */
    firstPrompt: string | null
    /** The turn the last chunk ends in is not over. */
    stillWorking: boolean
    now: () => number
    complete: RecapModelCall
  }
): Promise<SessionRecap | null> {
  let recap = start
  for (const chunk of chunks) {
    // What the host wrote down for these messages is the model's to say now, in its own words.
    const host = recap.degraded ? recapHostRequests(recap, chunk) : []
    const before =
      host.length > 0
        ? { ...recap, asked: recap.asked.filter((item) => !host.includes(item)) }
        : recap
    const prompt = recapPrompt(
      before,
      chunk,
      options.firstPrompt,
      options.stillWorking && chunk === chunks.at(-1)
    )
    const parsed = await askForRecapDelta(prompt.request, options.complete)
    if (!parsed.ok) {
      return null
    }
    recap = keepRecapHostRequestIds(
      applyRecapDelta(before, attachRecapRequests(parsed.delta, chunk, prompt.refOf), {
        now: options.now(),
        refs: prompt.refs
      }),
      before,
      host
    )
  }
  return recap
}
