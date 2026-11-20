// Where a Codex rollout's newest turn stands, read from its last records.
import { codexExecCellCalls } from '../transcripts/codex-exec-cell'
import { codexUserMessageText } from './codex-user-message'
import { replyAskOf } from './reply-ask'
import { askedQuestion, oneLine, rec, str, timeOf } from './transcript-records'
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

/** The calls that run a shell command, across Codex versions. */
const CODEX_SHELL_TOOLS: ReadonlySet<string> = new Set([
  'shell',
  'shell_command',
  'exec_command',
  'local_shell',
  'unified_exec',
  'container.exec'
])
const CODEX_CALLS: ReadonlySet<string> = new Set([
  'function_call',
  'custom_tool_call',
  'local_shell_call'
])
const CODEX_CALL_OUTPUTS: ReadonlySet<string> = new Set([
  'function_call_output',
  'custom_tool_call_output',
  'local_shell_call_output'
])
type Turn = Pick<TranscriptTurn, 'phase' | 'detail' | 'pendingTool' | 'settled'> &
  Partial<Pick<TranscriptTurn, 'pendingKind' | 'pendingSince'>>

function turn(phase: Turn['phase'], detail: string | null, extra?: Partial<Turn>): Turn {
  return { phase, detail, pendingTool: null, settled: false, ...extra }
}

function shellCall(
  command: string | null,
  record: TranscriptRecord,
  pendingKind: 'shell' | 'shell-wait' = 'shell'
): Turn {
  return turn('tool-pending', oneLine(`Bash: ${command ?? 'command'}`, 80), {
    pendingTool: 'shell',
    pendingKind,
    pendingSince: timeOf(record)
  })
}

function argumentsOf(payload: TranscriptRecord): TranscriptRecord | null {
  try {
    return rec(JSON.parse(str(payload.arguments) ?? 'null'))
  } catch {
    return null
  }
}

function commandText(command: unknown): string | null {
  return Array.isArray(command) ? command.join(' ') : str(command)
}

/** A call the rollout holds no output for: what the turn waits on, when the call says. */
function pendingCall(
  kind: string,
  payload: TranscriptRecord,
  record: TranscriptRecord
): Turn | null {
  const name = str(payload.name) ?? ''
  if (kind === 'local_shell_call') {
    return shellCall(commandText(rec(payload.action)?.command), record)
  }
  if (kind === 'custom_tool_call') {
    const cell = name === 'exec' ? codexExecCellCalls(str(payload.input) ?? '') : []
    const command = cell.find((call) => call.tool === 'exec_command' && call.text !== null)
    if (command) {
      return shellCall(command.text, record)
    }
    // `write_stdin` polls a command that outlived the `exec_command` that started it.
    if (cell.some((call) => call.tool === 'write_stdin')) {
      return shellCall(null, record, 'shell-wait')
    }
    if (name === 'apply_patch') {
      return turn('tool-pending', 'Edit: patch', {
        pendingTool: name,
        pendingKind: 'edit',
        pendingSince: timeOf(record)
      })
    }
    return turn('tool-pending', name || 'Tool', { pendingTool: name || 'tool' })
  }
  const args = argumentsOf(payload)
  if (name === 'request_user_input') {
    return turn('input-requested', askedQuestion(args) ?? 'Question for you', {
      pendingTool: name,
      settled: true
    })
  }
  if (CODEX_SHELL_TOOLS.has(name)) {
    return shellCall(commandText(args?.command) ?? str(args?.cmd), record)
  }
  // `wait` on a cell resumes a command that outlived its `exec` call; on anything else, helpers.
  if ((name === 'wait' && str(args?.cell_id)) || name === 'write_stdin') {
    return shellCall(null, record, 'shell-wait')
  }
  if (CODEX_WAIT_TOOLS.has(name)) {
    return turn('tool-pending', 'Waiting on helpers', { pendingTool: 'wait_agent' })
  }
  return null
}

/** The command a poll waits on: the one its turn started last. */
function commandBefore(records: TranscriptRecord[], index: number): string | null {
  for (let i = index - 1; i >= 0; i--) {
    const record = records[i]
    const payload = rec(record.payload)
    const kind = str(payload?.type)
    if (record.type === 'event_msg' && kind === 'task_started') {
      return null
    }
    if (record.type === 'response_item' && kind && payload && CODEX_CALLS.has(kind)) {
      const call = pendingCall(kind, payload, record)
      if (call?.pendingKind === 'shell') {
        return call.detail
      }
    }
  }
  return null
}

function turnOf(records: TranscriptRecord[]): Turn {
  const answered = new Set<string>()
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]
    const payload = rec(record.payload)
    const kind = str(payload?.type)
    if (record.type === 'response_item') {
      if (kind && CODEX_CALL_OUTPUTS.has(kind)) {
        answered.add(str(payload?.call_id) ?? '')
      } else if (
        kind &&
        payload &&
        CODEX_CALLS.has(kind) &&
        !answered.has(str(payload.call_id) ?? '')
      ) {
        const pending = pendingCall(kind, payload, record)
        if (pending) {
          return pending.pendingKind === 'shell-wait'
            ? { ...pending, detail: commandBefore(records, i) ?? pending.detail }
            : pending
        }
      }
      continue
    }
    if (record.type !== 'event_msg' || !kind) {
      continue
    }
    // Codex 0.169 ends a failed turn with `task_complete` carrying the error.
    const failure = kind === 'task_complete' ? rec(payload?.error) : null
    if (failure) {
      return turn('errored', oneLine(str(failure.message) ?? 'Error'), { settled: true })
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
      return shellCall(command, record)
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
    pendingKind: null,
    pendingSince: null,
    ...found,
    lastMessage: reply ? oneLine(reply, 200) : null,
    replyAsk: found.phase === 'turn-ended' && found.detail === null ? replyAskOf(reply) : 'tells'
  }
}
