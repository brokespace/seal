// What a judge sees of one request: the user's words, then what was said and done after them, in the
// words a reader of the session would see. Nothing else: no ids, no statuses, no tool output.
import { nativeChatFullCommand } from '../../../shared/native-chat/tools/native-chat-tool-input-text'
import { toolFilePath } from '../../../shared/native-chat/tools/native-chat-tool-summary'
import type { RecapJudgedItem } from './recap-judge-labels.test-fixture'
import type { RecapScenarioStep } from './recap-scenario-schema.test-fixture'

export type RecapJudgeState = { request: string; conversation: string }

const MAX_COMMAND_CHARS = 120
/** The design's largest chunk; a longer span keeps its start and, with most of the room, its end. */
export const RECAP_JUDGE_STATE_CHARS = 24_000

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}\u2026` : text

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

function toolLine(name: string, input: Record<string, unknown>): string {
  const command = nativeChatFullCommand(input)
  if (command) {
    return `AGENT ran: ${clip(command, MAX_COMMAND_CHARS)}`
  }
  const started = text(input.description) ?? text(input.prompt)
  if ((name === 'Task' || name === 'Agent') && started) {
    return `AGENT started a subagent: ${started}`
  }
  const path = toolFilePath(input)
  return path ? `AGENT used ${name} on ${path}` : `AGENT used ${name}`
}

function linesOf(step: RecapScenarioStep): string[] {
  if ('user' in step) {
    return [`USER: ${step.user}`]
  }
  if ('agent' in step) {
    return [`AGENT: ${step.agent}`]
  }
  if ('edit' in step) {
    return [`AGENT edited ${step.edit}`]
  }
  if ('tool' in step) {
    return [toolLine(step.tool.name, step.tool.input)]
  }
  if ('question' in step) {
    const { text: asked, options, answer } = step.question
    return [
      `AGENT asked: ${asked} (${options.join(' / ')})`,
      ...(answer === undefined ? [] : [`USER picked: ${answer}`])
    ]
  }
  if ('subagent' in step) {
    return [
      `AGENT started a subagent: ${step.subagent.prompt}`,
      `SUBAGENT reported: ${step.subagent.result}`
    ]
  }
  if ('compact' in step) {
    return ['(the agent compacted its context here)']
  }
  // Harness records, statuses, the clock and the recap's own controls are not conversation.
  return []
}

function fitted(lines: readonly string[], max: number): string {
  if (lines.join('\n').length <= max) {
    return lines.join('\n')
  }
  const head: string[] = []
  const tail: string[] = []
  let room = max / 4
  for (const line of lines) {
    if (line.length > room) {
      break
    }
    head.push(line)
    room -= line.length + 1
  }
  room = (max * 3) / 4
  for (const line of lines.slice(head.length).toReversed()) {
    if (line.length > room) {
      break
    }
    tail.unshift(line)
    room -= line.length + 1
  }
  const dropped = lines.length - head.length - tail.length
  return [...head, `(${dropped} lines of the conversation are left out here)`, ...tail].join('\n')
}

export function recapJudgeState(
  item: RecapJudgedItem,
  maxChars = RECAP_JUDGE_STATE_CHARS
): RecapJudgeState {
  return { request: item.request, conversation: fitted(item.since.flatMap(linesOf), maxChars) }
}
