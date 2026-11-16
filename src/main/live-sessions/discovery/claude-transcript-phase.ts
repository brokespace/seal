// Where a Claude Code transcript's newest turn stands, read from its last records.
import {
  askedQuestion,
  blocks,
  contentText,
  oneLine,
  rec,
  str,
  timeOf,
  toolLabel
} from './transcript-records'
import type { TranscriptRecord } from './transcript-records'
import { replyAskOf } from './reply-ask'
import type { PendingCallKind, TranscriptTurn } from './transcript-summary'

/** Tools that hand the turn to the user: the call stays open until they answer. */
const ASK_TOOLS: Partial<Record<string, string>> = {
  AskUserQuestion: 'Question for you',
  ExitPlanMode: 'Plan ready for review'
}

export function isClaudeAskTool(name: string): boolean {
  return ASK_TOOLS[name] !== undefined
}

/** The tools that start a subagent (`Task` before Claude Code 2.x renamed it). */
export const CLAUDE_SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task'])

/** Tools whose call stands until a command or task an earlier call started reports. */
const BACKGROUND_WAIT_TOOLS: ReadonlySet<string> = new Set(['BashOutput', 'TaskOutput'])

export function isClaudeBackgroundWaitTool(name: string): boolean {
  return BACKGROUND_WAIT_TOOLS.has(name)
}

/** Tools that change files at once unless a permission prompt holds them. */
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

type Turn = Pick<TranscriptTurn, 'phase' | 'detail' | 'pendingTool' | 'settled'> &
  Partial<Pick<TranscriptTurn, 'pendingKind' | 'pendingSince'>>

const WORKING: Turn = { phase: 'working', detail: 'Thinking', pendingTool: null, settled: false }

function pendingKind(name: string, input: TranscriptRecord | null): PendingCallKind | null {
  if (name === 'Bash') {
    // A background command returns at once; only a foreground one holds the call open while it runs.
    return input?.run_in_background === true ? null : 'shell'
  }
  if (isClaudeBackgroundWaitTool(name)) {
    return 'shell-wait'
  }
  return EDIT_TOOLS.has(name) ? 'edit' : null
}

/** A prompt the user typed, not a command echo, hook text or tool result. */
export function claudePromptText(record: TranscriptRecord): string | null {
  if (record.isMeta === true || record.isSidechain === true) {
    return null
  }
  const trimmed = contentText(rec(record.message)?.content).trim()
  if (!trimmed || trimmed.startsWith('<') || trimmed.startsWith('[Request interrupted')) {
    return null
  }
  return trimmed
}

function isInterruption(content: unknown): boolean {
  const text = typeof content === 'string' ? content : ''
  return (
    text.startsWith('[Request interrupted') ||
    blocks(content).some((b) => str(b.text)?.startsWith('[Request interrupted'))
  )
}

function assistantError(record: TranscriptRecord): Turn | null {
  if (record.isApiErrorMessage !== true && !record.error) {
    return null
  }
  const text = blocks(rec(record.message)?.content).find((b) => b.type === 'text')
  return {
    phase: 'errored',
    detail: oneLine(str(text?.text) ?? 'API error'),
    pendingTool: null,
    settled: true
  }
}

/** A turn the API refused still closes with its duration record; the error is the reply before it. */
function errorBefore(records: TranscriptRecord[], index: number): Turn | null {
  for (let i = index - 1; i >= 0; i--) {
    const record = records[i]
    if (record.isSidechain === true) {
      continue
    }
    if (record.type === 'assistant') {
      return assistantError(record)
    }
    if (record.type === 'user') {
      return null
    }
  }
  return null
}

function pendingTool(tool: TranscriptRecord, record: TranscriptRecord): Turn {
  const name = str(tool.name) ?? 'Tool'
  const ask = ASK_TOOLS[name]
  return ask
    ? {
        phase: 'input-requested',
        detail: askedQuestion(rec(tool.input)) ?? ask,
        pendingTool: name,
        settled: true
      }
    : {
        phase: 'tool-pending',
        detail: toolLabel(name, rec(tool.input)),
        pendingTool: name,
        pendingKind: pendingKind(name, rec(tool.input)),
        pendingSince: timeOf(record),
        settled: false
      }
}

function turnOf(records: TranscriptRecord[]): Turn {
  // Parallel tool calls are separate records: one result does not close the others.
  const answered = new Set<string>()
  let afterResult = false
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]
    if (record.isSidechain === true) {
      continue
    }
    if (record.type === 'system') {
      if (record.subtype === 'api_error' || record.level === 'error') {
        return {
          phase: 'errored',
          detail: oneLine(str(record.content) ?? 'API error'),
          pendingTool: null,
          settled: true
        }
      }
      if (record.subtype === 'scheduled_task_fire') {
        // A wake-up the agent scheduled starts a turn with no prompt from the user.
        return WORKING
      }
      if (record.subtype === 'turn_duration' || record.subtype === 'stop_hook_summary') {
        return (
          errorBefore(records, i) ?? {
            phase: 'turn-ended',
            detail: null,
            pendingTool: null,
            settled: true
          }
        )
      }
      continue
    }
    const content = rec(record.message)?.content
    if (record.type === 'assistant') {
      const failed = assistantError(record)
      if (failed) {
        return failed
      }
      const tools = blocks(content).filter((b) => b.type === 'tool_use')
      const open = tools.findLast((tool) => !answered.has(str(tool.id) ?? ''))
      if (open) {
        return pendingTool(open, record)
      }
      if (tools.length > 0 && afterResult) {
        continue
      }
      if (afterResult || tools.length > 0) {
        return WORKING
      }
      return blocks(content).some((b) => b.type === 'text')
        ? {
            phase: 'turn-ended',
            detail: null,
            pendingTool: null,
            settled: rec(record.message)?.stop_reason === 'end_turn'
          }
        : WORKING
    }
    if (record.type === 'user') {
      if (isInterruption(content)) {
        return { phase: 'turn-ended', detail: 'Interrupted', pendingTool: null, settled: true }
      }
      const text = typeof content === 'string' ? content : ''
      if (
        record.isMeta === true ||
        text.startsWith('<local-command') ||
        text.startsWith('<command-name>')
      ) {
        continue
      }
      const results = blocks(content).filter((b) => b.type === 'tool_result')
      if (results.length === 0) {
        return WORKING
      }
      for (const result of results) {
        answered.add(str(result.tool_use_id) ?? '')
      }
      afterResult = true
    }
  }
  return afterResult
    ? WORKING
    : { phase: 'unknown', detail: null, pendingTool: null, settled: false }
}

function lastReply(records: TranscriptRecord[]): string | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]
    if (record.type !== 'assistant' || record.isSidechain === true) {
      continue
    }
    const text = contentText(rec(record.message)?.content).trim()
    if (text) {
      return text
    }
  }
  return null
}

export function claudePhase(records: TranscriptRecord[]): TranscriptTurn {
  const turn = turnOf(records)
  const reply = lastReply(records)
  return {
    pendingKind: null,
    pendingSince: null,
    ...turn,
    lastMessage: reply ? oneLine(reply, 200) : null,
    replyAsk: turn.phase === 'turn-ended' && turn.detail === null ? replyAskOf(reply) : 'tells'
  }
}
