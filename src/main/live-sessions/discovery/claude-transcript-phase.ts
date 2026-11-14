// Where a Claude Code transcript's newest turn stands, read from its last records.
import { blocks, contentText, oneLine, rec, str, toolLabel } from './transcript-records'
import type { TranscriptRecord } from './transcript-records'
import type { TranscriptTurn } from './transcript-summary'

/** Tools that hand the turn to the user: the call stays open until they answer. */
const ASK_TOOLS: Partial<Record<string, string>> = {
  AskUserQuestion: 'Question for you',
  ExitPlanMode: 'Plan ready for review'
}

/** The tools that start a subagent (`Task` before Claude Code 2.x renamed it). */
export const CLAUDE_SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task'])

type Turn = Omit<TranscriptTurn, 'lastMessage' | 'asksUser'>

const WORKING: Turn = { phase: 'working', detail: 'Thinking', pendingTool: null, settled: false }

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

function pendingTool(tool: TranscriptRecord): Turn {
  const name = str(tool.name) ?? 'Tool'
  const ask = ASK_TOOLS[name]
  return ask
    ? { phase: 'input-requested', detail: ask, pendingTool: name, settled: true }
    : {
        phase: 'tool-pending',
        detail: toolLabel(name, rec(tool.input)),
        pendingTool: name,
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
      if (record.subtype === 'turn_duration' || record.subtype === 'stop_hook_summary') {
        return { phase: 'turn-ended', detail: null, pendingTool: null, settled: true }
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
        return pendingTool(open)
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

/** A reply whose last line is a question leaves the next move to the user. */
export function endsWithQuestion(text: string | null): boolean {
  return (
    text
      ?.trim()
      .split('\n')
      .at(-1)
      ?.trim()
      .replace(/[*_`)\]"']+$/, '')
      .endsWith('?') === true
  )
}

export function claudePhase(records: TranscriptRecord[]): TranscriptTurn {
  const turn = turnOf(records)
  const reply = lastReply(records)
  return {
    ...turn,
    lastMessage: reply ? oneLine(reply, 200) : null,
    asksUser: turn.phase === 'turn-ended' && turn.detail === null && endsWithQuestion(reply)
  }
}
