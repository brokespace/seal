// The reader contract: what the judge is shown of a session after a request, in the words a reader
// of the session would see. No ids, no statuses, no tool output. The judge's thresholds were
// measured on these exact line shapes, so a reader for a new surface writes its lines with them.
import type { NativeChatMessage } from '../../shared/native-chat/native-chat-types'
import { editFilesFromBeginPatch } from '../../shared/native-chat/tools/native-chat-begin-patch'
import {
  editFilesFromToolPair,
  isEditToolName
} from '../../shared/native-chat/tools/native-chat-edit-normalize'
import { nativeChatFullCommand } from '../../shared/native-chat/tools/native-chat-tool-input-text'
import {
  normalizeToolInput,
  toolFilePath
} from '../../shared/native-chat/tools/native-chat-tool-summary'
import { codexExecCellCalls } from '../live-sessions/transcripts/codex-exec-cell'
import { clipProseMiddle, sessionProse } from '../session-summaries/session-summary-text'
import { jsonRecord } from '../utility-model/utility-model-http-request'
import { asksSomething } from './session-recap-transcript'

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

/** Claude's, Codex's, and OpenCode 1's and 2's as they reach a chat's journal. */
const SUBAGENT_TOOLS = new Set(['Task', 'Agent', 'spawn_agent', 'task', 'subagent'])

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
  if (SUBAGENT_TOOLS.has(name) && started) {
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

const QUESTION_TOOLS = new Set(['AskUserQuestion', 'request_user_input'])
const BACKGROUND_ENDS: ReadonlySet<string> = new Set(['completed', 'failed', 'stopped'])
// The thresholds were measured on whole messages: these only keep a paste from filling the state.
const USER_HEAD_CHARS = 4000
const USER_TAIL_CHARS = 2000
const AGENT_HEAD_CHARS = 1500
const AGENT_TAIL_CHARS = 3000

type OpenCall = {
  /** Where its line sits, so a result can complete it. */
  index: number
  callId: string | undefined
  kind: 'question' | 'subagent' | 'other'
  question: string | null
  prompt: string | null
  /** Told to outlive its call: `launched` once the call returned, and its report still to come. */
  background: 'launching' | 'launched' | null
}

const field = (input: unknown, key: string): unknown => jsonRecord(input)?.[key]

function proseOf(message: NativeChatMessage): string {
  return sessionProse(
    message.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
  )
}

function questionOf(input: unknown): { question: string; options: string[] } | null {
  const questions = field(input, 'questions')
  const first = Array.isArray(questions) ? jsonRecord(questions[0]) : null
  const question = said(first?.question)
  if (!question) {
    return null
  }
  const options = Array.isArray(first?.options) ? first.options : []
  return {
    question,
    options: options.flatMap((option) => said(jsonRecord(option)?.label) ?? said(option) ?? [])
  }
}

/** The files an edit tool's call names: its own path, or every file of a patch envelope. */
function editedPaths(name: string, input: unknown): string[] {
  if (!isEditToolName(name)) {
    return []
  }
  const path = toolFilePath(input)
  return path
    ? [path]
    : (editFilesFromToolPair({ name, input, state: 'completed' })?.map((file) => file.path) ?? [])
}

/** What a Codex code-mode cell ran, one line per tool it called; null for any other call. */
function execCellLines(
  name: string,
  input: unknown,
  redact: (command: string) => string
): string[] | null {
  const calls = name === 'exec' && typeof input === 'string' ? codexExecCellCalls(input) : []
  if (calls.length === 0) {
    return null
  }
  return calls.flatMap(({ tool, text }) => {
    if (tool === 'exec_command' && text) {
      return [recapToolLine(tool, { cmd: text }, redact)]
    }
    // A poll of a command already running, or keys sent to it: the command has its own line.
    if (tool === 'write_stdin') {
      return []
    }
    const edited = tool === 'apply_patch' && text ? editFilesFromBeginPatch(text) : []
    return edited.length > 0
      ? edited.map((file) => recapConversationLine.edited(file.path))
      : [recapConversationLine.used(tool, null)]
  })
}

/** The option the user picked, from a question tool's result as Claude or Codex writes it. */
function pickedIn(output: string, question: string | null): string | null {
  try {
    const answers = jsonRecord(jsonRecord(JSON.parse(output))?.answers)
    const first = answers ? Object.values(answers)[0] : null
    const given = jsonRecord(first)?.answers
    return said(Array.isArray(given) ? given[0] : first)
  } catch {
    const at = question ? output.indexOf(`"${question}"="`) : -1
    const from = at === -1 ? -1 : at + (question?.length ?? 0) + 4
    const to = from === -1 ? -1 : output.indexOf('"', from)
    return to === -1 ? null : said(output.slice(from, to))
  }
}

/**
 * A session's messages from one request on, as the judge reads them. Null when the request's
 * message is not among `messages`. `redact` is applied to every command line before it is kept.
 */
export function recapConversationSince(
  messages: readonly NativeChatMessage[],
  requestMessageId: string,
  redact: (command: string) => string
): RecapConversation | null {
  const start = messages.findIndex((message) => message.id === requestMessageId)
  if (start === -1) {
    return null
  }
  const lines: string[] = []
  const open: OpenCall[] = []
  let userTurns = -1
  let endsOnUser = false
  let complete = true
  const say = (line: string, byUser: boolean): void => {
    lines.push(line)
    endsOnUser = byUser
  }
  for (const message of messages.slice(start)) {
    // Another agent's message, a slash command or a launch fact is not the user speaking.
    if (message.from || message.command || message.agentStart) {
      continue
    }
    const prose = proseOf(message)
    if (message.role === 'user' && asksSomething(message, prose)) {
      userTurns += 1
      say(
        recapConversationLine.user(clipProseMiddle(prose, USER_HEAD_CHARS, USER_TAIL_CHARS)),
        true
      )
    } else if (message.role === 'assistant' && prose) {
      say(
        recapConversationLine.agent(clipProseMiddle(prose, AGENT_HEAD_CHARS, AGENT_TAIL_CHARS)),
        false
      )
    }
    for (const block of message.blocks) {
      if (block.type === 'text') {
        // Codex records one compaction twice: as the summary it kept and as the event.
        if (
          block.presentation === 'compaction' &&
          lines.at(-1) !== recapConversationLine.compacted
        ) {
          say(recapConversationLine.compacted, false)
        }
      } else if (block.type === 'tool-call') {
        // Codex hands a call's arguments over as a JSON string.
        const input = normalizeToolInput(block.input)
        const asked = QUESTION_TOOLS.has(block.name) ? questionOf(input) : null
        const cell = asked ? null : execCellLines(block.name, input, redact)
        const edited = asked || cell ? [] : editedPaths(block.name, input)
        open.push({
          index: lines.length,
          callId: block.callId,
          kind: asked ? 'question' : SUBAGENT_TOOLS.has(block.name) ? 'subagent' : 'other',
          question: asked?.question ?? null,
          prompt: said(field(input, 'prompt')) ?? said(field(input, 'message')),
          background:
            field(input, 'run_in_background') === true || field(input, 'background') === true
              ? 'launching'
              : null
        })
        if (asked) {
          say(recapConversationLine.asked(asked.question, asked.options), false)
        } else if (cell) {
          cell.forEach((line) => say(line, false))
        } else if (edited.length === 0) {
          say(recapToolLine(block.name, input, redact), false)
        }
        for (const path of edited) {
          say(recapConversationLine.edited(path), false)
        }
      } else if (block.type === 'tool-result') {
        const at = block.callId ? open.findIndex((call) => call.callId === block.callId) : 0
        const found = at === -1 ? undefined : open[at]
        if (found?.background === 'launching') {
          // The call returns as it launches the work; what the work found comes in a later record.
          found.background = 'launched'
          continue
        }
        const [call] = at === -1 ? [] : open.splice(at, 1)
        const output = block.output.trim()
        if (call?.kind === 'question') {
          const picked = pickedIn(output, call.question)
          if (picked) {
            say(recapConversationLine.picked(picked), true)
          }
        } else if (call?.kind === 'subagent' && call.prompt && output) {
          lines[call.index] = recapConversationLine.startedSubagent(call.prompt)
          say(recapConversationLine.subagentReported(sessionProse(output)), false)
        }
      } else if (block.type === 'subagent' && block.background) {
        if (!BACKGROUND_ENDS.has(block.state)) {
          complete = false
          continue
        }
        // A chat's journal keeps a background subagent's result on its own row once it has ended,
        // and the call that launched it gets no second result: it waits for nothing more.
        const launched = open.findIndex(
          (call) => call.kind === 'subagent' && call.background !== null
        )
        if (launched !== -1) {
          open.splice(launched, 1)
        }
        if (block.lastMessage?.trim()) {
          say(recapConversationLine.subagentReported(sessionProse(block.lastMessage)), false)
        }
      } else if (block.type === 'background-task') {
        complete &&= block.state === 'done'
      }
    }
  }
  // Work still running in the background has not reported: the judge has not seen all of it.
  complete &&= open.every((call) => call.background === null)
  return { lines, userTurns: Math.max(0, userTurns), endsOnUser, complete }
}
