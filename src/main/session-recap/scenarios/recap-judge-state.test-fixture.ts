// What a judge sees of one labelled request: the user's words, then what the script says and does
// after them, written with the lines the product's readers write.
import {
  fitRecapConversation,
  RECAP_JUDGE_STATE_CHARS,
  recapConversationLine as line,
  recapToolLine
} from '../session-recap-conversation'
import type { RecapJudgeState } from '../session-recap-judge'
import type { RecapJudgedItem } from './recap-judge-labels.test-fixture'
import type { RecapScenarioStep } from './recap-scenario-schema.test-fixture'

export type { RecapJudgeState }

function linesOf(step: RecapScenarioStep): string[] {
  if ('user' in step) {
    return [line.user(step.user)]
  }
  if ('agent' in step) {
    return [line.agent(step.agent)]
  }
  if ('edit' in step) {
    return [line.edited(step.edit)]
  }
  if ('tool' in step) {
    return [recapToolLine(step.tool.name, step.tool.input)]
  }
  if ('question' in step) {
    const { text: asked, options, answer } = step.question
    return [line.asked(asked, options), ...(answer === undefined ? [] : [line.picked(answer)])]
  }
  if ('subagent' in step) {
    return [line.startedSubagent(step.subagent.prompt), line.subagentReported(step.subagent.result)]
  }
  if ('compact' in step) {
    return [line.compacted]
  }
  // Harness records, statuses, the clock and the recap's own controls are not conversation.
  return []
}

/** The script's steps as conversation lines; harness steps give none. */
export const recapScenarioStepLines = linesOf

export function recapJudgeState(
  item: RecapJudgedItem,
  maxChars = RECAP_JUDGE_STATE_CHARS
): RecapJudgeState {
  return {
    request: item.request,
    conversation: fitRecapConversation(item.since.flatMap(linesOf), maxChars).text
  }
}
