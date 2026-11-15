// Codex's background terminals: a command `exec_command` handed back to the model still running
// (unified exec). It outlives its call and its turn, and is polled with `write_stdin`. Recorded
// from Codex 0.169 as a function call, and as a call inside an `exec` cell.
import { jsonField, oneLine, rec, str, timeOf } from './transcript-records'
import type { TranscriptRecord } from './transcript-records'

export type CodexTerminal = {
  /** Codex's id for the running command, which `write_stdin` polls it by. */
  sessionId: string
  command: string | null
  startedAt: number | null
}

export type CodexTerminalState = {
  /** Calls whose output is still to come, by call id. */
  calls: Map<string, { command: string | null; polls: string | null; at: number | null }>
  /** The terminals still running as far as the rollout says. */
  running: Map<string, CodexTerminal>
}

export function newCodexTerminalState(): CodexTerminalState {
  return { calls: new Map(), running: new Map() }
}

const CELL_COMMAND = /\bexec_command\(\s*\{[^}]*?\bcmd:\s*(["'`])((?:\\.|(?!\1).)*)\1/s
const CELL_POLL = /\bwrite_stdin\(\s*\{[^}]*?\bsession_id:\s*(\d+)/s

function callOf(
  payload: TranscriptRecord
): { command: string | null; polls: string | null } | null {
  const name = str(payload.name)
  if (payload.type === 'custom_tool_call') {
    const input = str(payload.input) ?? ''
    const polls = CELL_POLL.exec(input)?.[1] ?? null
    const command = CELL_COMMAND.exec(input)?.[2] ?? null
    return name === 'exec' && (polls || command) ? { command, polls } : null
  }
  const args = jsonField(payload.arguments)
  if (name === 'exec_command') {
    return { command: str(args?.cmd), polls: null }
  }
  if (name === 'write_stdin' && args?.session_id !== undefined) {
    return { command: null, polls: String(args.session_id) }
  }
  return null
}

/**
 * The terminal an output hands back still running: named in the header above the command's own
 * output (a function call), or in the chunk a cell prints as JSON.
 */
function stillRunning(output: unknown): string | null {
  const parts = typeof output === 'string' ? [output] : Array.isArray(output) ? output : []
  for (const part of parts) {
    const text = typeof part === 'string' ? part : str(rec(part)?.text)
    if (!text) {
      continue
    }
    const header = /^Process running with session ID (\d+)$/m.exec(text.split('\nOutput:', 1)[0])
    if (header) {
      return header[1]
    }
    const chunk = text.startsWith('{') ? jsonField(text) : null
    if (typeof chunk?.session_id === 'number') {
      return String(chunk.session_id)
    }
  }
  return null
}

/** Folds a rollout's records, oldest first; reading the same records again changes nothing. */
export function foldCodexTerminals(state: CodexTerminalState, records: TranscriptRecord[]): void {
  for (const record of records) {
    const payload = rec(record.payload)
    const kind = str(payload?.type)
    const callId = str(payload?.call_id)
    if (record.type !== 'response_item' || !payload || !callId) {
      continue
    }
    if (kind === 'function_call' || kind === 'custom_tool_call') {
      const call = callOf(payload)
      if (call) {
        state.calls.set(callId, { ...call, at: timeOf(record) })
      }
      continue
    }
    const call = state.calls.get(callId)
    if (!call || (kind !== 'function_call_output' && kind !== 'custom_tool_call_output')) {
      continue
    }
    state.calls.delete(callId)
    const sessionId = stillRunning(payload.output)
    if (sessionId) {
      const had = state.running.get(sessionId)
      state.running.set(sessionId, {
        sessionId,
        command: had?.command ?? (call.command ? oneLine(call.command, 80) : null),
        startedAt: had?.startedAt ?? call.at
      })
    } else if (call.polls) {
      // The poll came back without it: the command exited, or Codex no longer has it.
      state.running.delete(call.polls)
    }
  }
}
