// The reader contract: what the judge is shown of a session after a request, in the words a reader
// of the session would see. No ids, no statuses, no tool output. The judge's thresholds were
// measured on these exact line shapes, so a reader for a new surface writes its lines with them.
import { nativeChatFullCommand } from '../../shared/native-chat/tools/native-chat-tool-input-text'
import { toolFilePath } from '../../shared/native-chat/tools/native-chat-tool-summary'

const MAX_COMMAND_CHARS = 120
/** The largest state a judge is sent. A decision model cuts a longer one without saying so. */
export const RECAP_JUDGE_STATE_CHARS = 24_000

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}\u2026` : text

const said = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

export const recapConversationLine = {
  user: (text: string): string => `USER: ${text}`,
  agent: (text: string): string => `AGENT: ${text}`,
  edited: (path: string): string => `AGENT edited ${path}`,
  /** A command line only, never what it printed. The caller redacts it first. */
  ran: (command: string): string => `AGENT ran: ${clip(command, MAX_COMMAND_CHARS)}`,
  startedSubagent: (prompt: string): string => `AGENT started a subagent: ${prompt}`,
  subagentReported: (result: string): string => `SUBAGENT reported: ${result}`,
  asked: (question: string, options: readonly string[]): string =>
    `AGENT asked: ${question} (${options.join(' / ')})`,
  picked: (answer: string): string => `USER picked: ${answer}`,
  used: (tool: string, path: string | null): string =>
    path ? `AGENT used ${tool} on ${path}` : `AGENT used ${tool}`,
  compacted: '(the agent compacted its context here)'
} as const

/** The line for a tool call that is not an edit, a question or a finished subagent. */
export function recapToolLine(
  name: string,
  input: unknown,
  redact: (command: string) => string = (command) => command
): string {
  const command = nativeChatFullCommand(input)
  if (command) {
    return recapConversationLine.ran(redact(command))
  }
  const fields = typeof input === 'object' && input !== null ? input : {}
  const started =
    said('description' in fields ? fields.description : null) ??
    said('prompt' in fields ? fields.prompt : null)
  if ((name === 'Task' || name === 'Agent') && started) {
    return recapConversationLine.startedSubagent(started)
  }
  return recapConversationLine.used(name, toolFilePath(input))
}

export type FittedRecapConversation = {
  text: string
  /** Lines left out of the middle; above 0 the judge has not seen everything. */
  dropped: number
}

/** A conversation longer than `max` keeps its start and, with most of the room, its end. */
export function fitRecapConversation(
  lines: readonly string[],
  max = RECAP_JUDGE_STATE_CHARS
): FittedRecapConversation {
  if (lines.join('\n').length <= max) {
    return { text: lines.join('\n'), dropped: 0 }
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
  return {
    text: [...head, `(${dropped} lines of the conversation are left out here)`, ...tail].join('\n'),
    dropped
  }
}

/** A session's conversation from one request on, as a reader hands it to the judge. */
export type RecapConversation = {
  /** The request's own message first, then everything said and done after it. */
  lines: string[]
  /** User messages after the request's own: how many turns old it is. */
  userTurns: number
  /** The last line is the user's: the agent has not answered it, so its turn is not over. */
  endsOnUser: boolean
  /**
   * False when the reader knows it could not see everything: the request's message was not found,
   * the read stopped short of the transcript's end, or work ran where this reader cannot look.
   */
  complete: boolean
}
