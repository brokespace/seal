// Where a Codex rollout's newest turn stands, read from its last records.
import { codexUserMessageText } from './codex-user-message'
import { endsWithQuestion } from './claude-transcript-phase'
import { oneLine, rec, str } from './transcript-records'
import type { TranscriptRecord } from './transcript-records'
import type { TranscriptTurn } from './transcript-summary'

const CODEX_WORKING = new Set([
  'task_started',
  'user_message',
  'agent_reasoning',
  'agent_reasoning_delta',
  'exec_command_begin',
  'exec_command_end',
  'patch_apply_begin',
  'patch_apply_end',
  'mcp_tool_call_begin',
  'mcp_tool_call_end',
  'web_search_begin',
  'web_search_end',
  'collab_waiting_end',
  'collab_agent_spawn_begin',
  'collab_agent_spawn_end'
])

/** The calls that park a Codex turn until its helper threads report back. */
export const CODEX_WAIT_TOOLS: ReadonlySet<string> = new Set(['wait_agent', 'wait'])

type Turn = Omit<TranscriptTurn, 'lastMessage' | 'asksUser'>

function turn(phase: Turn['phase'], detail: string | null, extra?: Partial<Turn>): Turn {
  return { phase, detail, pendingTool: null, settled: false, ...extra }
}

function turnOf(records: TranscriptRecord[]): Turn {
  const answered = new Set<string>()
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]
    const payload = rec(record.payload)
    const kind = str(payload?.type)
    if (record.type === 'response_item') {
      if (kind === 'function_call_output') {
        answered.add(str(payload?.call_id) ?? '')
      } else if (
        kind === 'function_call' &&
        CODEX_WAIT_TOOLS.has(str(payload?.name) ?? '') &&
        !answered.has(str(payload?.call_id) ?? '')
      ) {
        return turn('tool-pending', 'Waiting on helpers', { pendingTool: 'wait_agent' })
      }
      continue
    }
    if (record.type !== 'event_msg' || !kind) {
      continue
    }
    if (kind === 'task_complete' || kind === 'turn_aborted') {
      return turn('turn-ended', kind === 'turn_aborted' ? 'Interrupted' : null, { settled: true })
    }
    if (kind === 'error' || kind === 'stream_error') {
      return turn('errored', oneLine(str(payload?.message) ?? 'Error'), { settled: true })
    }
    if (kind === 'exec_approval_request' || kind === 'apply_patch_approval_request') {
      const command = Array.isArray(payload?.command) ? payload.command.join(' ') : null
      return turn('approval-requested', command ? oneLine(`Allow ${command}?`, 80) : 'Allow edit?')
    }
    if (kind === 'request_user_input' || kind === 'elicitation_request') {
      return turn('input-requested', 'Question for you', { settled: true })
    }
    if (kind === 'collab_waiting_begin') {
      return turn('tool-pending', 'Waiting on helpers', { pendingTool: 'wait_agent' })
    }
    if (kind === 'exec_command_begin') {
      const command = Array.isArray(payload?.command) ? payload.command.join(' ') : 'command'
      return turn('tool-pending', oneLine(`Bash: ${command}`, 80), { pendingTool: 'shell' })
    }
    if (CODEX_WORKING.has(kind) || codexUserMessageText(record) !== null) {
      return turn('working', 'Thinking')
    }
  }
  return turn('unknown', null)
}

function lastReply(records: TranscriptRecord[]): string | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const payload = rec(records[i].payload)
    if (records[i].type !== 'event_msg') {
      continue
    }
    const text =
      payload?.type === 'agent_message'
        ? str(payload.message)
        : payload?.type === 'task_complete'
          ? str(payload.last_agent_message)
          : null
    if (text?.trim()) {
      return text.trim()
    }
  }
  return null
}

export function codexPhase(records: TranscriptRecord[]): TranscriptTurn {
  const found = turnOf(records)
  const reply = lastReply(records)
  return {
    ...found,
    lastMessage: reply ? oneLine(reply, 200) : null,
    asksUser: found.phase === 'turn-ended' && found.detail === null && endsWithQuestion(reply)
  }
}
