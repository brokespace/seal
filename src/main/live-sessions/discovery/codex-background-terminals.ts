// Codex's background terminals: a command `exec_command` handed back to the model still running
// (unified exec). It outlives its call and its turn, and is polled with `write_stdin`. Recorded
// from Codex 0.169 as a function call, and as a call inside an `exec` cell.
import type { LiveSubagentStatus } from '../../../shared/live-sessions/live-session-activity'
import { jsonField, oneLine, rec, str, timeOf } from './transcript-records'
import type { TranscriptRecord } from './transcript-records'

/** How the rollout says a command ended. */
export type CodexTerminalEnd = {
  status: Exclude<LiveSubagentStatus, 'running'>
  exitCode: number | null
}

export type CodexTerminal = {
  /** Codex's id for the running command, which `write_stdin` polls it by. */
  sessionId: string
  command: string | null
  startedAt: number | null
  /** Null while the command still runs as far as the rollout says. */
  ended: CodexTerminalEnd | null
}

export type CodexTerminalState = {
  /** Calls whose output is still to come, by call id. */
  calls: Map<string, { command: string | null; polls: string | null; at: number | null }>
  /** The terminals a call handed back running, and how each ended once the rollout says. */
  terminals: Map<string, CodexTerminal>
}

export function newCodexTerminalState(): CodexTerminalState {
  return { calls: new Map(), terminals: new Map() }
}

/** A shell reports a command a signal ended as 128 plus the signal: it was stopped, it did not fail. */
const SIGNAL_EXIT = 128
const SIGNALS = 64

function endOf(exitCode: number | null, failed: boolean): CodexTerminalEnd {
  if (exitCode !== null && exitCode > SIGNAL_EXIT && exitCode <= SIGNAL_EXIT + SIGNALS) {
    return { status: 'stopped', exitCode }
  }
  return { status: failed || (exitCode ?? 0) !== 0 ? 'failed' : 'completed', exitCode }
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
 * What an output says of its command: the terminal it hands back still running, or that it exited.
 * Read from the header above the command's own output (a function call), or from the chunk a
 * cell prints as JSON. A poll the user interrupted says neither, and its command runs on.
 */
function outcomeOf(output: unknown): { running: string | null; exited: CodexTerminalEnd | null } {
  const parts = typeof output === 'string' ? [output] : Array.isArray(output) ? output : []
  for (const part of parts) {
    const text = typeof part === 'string' ? part : str(rec(part)?.text)
    if (!text) {
      continue
    }
    const header = text.split('\nOutput:', 1)[0]
    const chunk = text.startsWith('{') ? jsonField(text) : null
    const running =
      /^Process running with session ID (\d+)$/m.exec(header)?.[1] ??
      (typeof chunk?.session_id === 'number' ? String(chunk.session_id) : null)
    if (running) {
      return { running, exited: null }
    }
    const code =
      /^Process exited with code (-?\d+)$/m.exec(header)?.[1] ??
      (typeof chunk?.exit_code === 'number' ? chunk.exit_code : null)
    if (code !== null) {
      return { running: null, exited: endOf(Number(code), false) }
    }
  }
  return { running: null, exited: null }
}

/** The terminal a finished command ran in: Codex writes this when one ends, polled or not, in or after its turn. */
function endedTerminal(
  payload: TranscriptRecord | null
): { sessionId: string; end: CodexTerminalEnd } | null {
  const item = rec(payload?.item)
  const id = item?.process_id
  if (item?.type !== 'CommandExecution' || (typeof id !== 'string' && typeof id !== 'number')) {
    return null
  }
  const exitCode = typeof item.exit_code === 'number' ? item.exit_code : null
  return { sessionId: String(id), end: endOf(exitCode, item.status === 'failed') }
}

/** An ended command stays, as Claude's do: the session's tasks list says how it ended. */
function end(state: CodexTerminalState, sessionId: string, ended: CodexTerminalEnd): void {
  const terminal = state.terminals.get(sessionId)
  if (terminal) {
    terminal.ended = ended
  }
}

/** Folds a rollout's records, oldest first; reading the same records again changes nothing. */
export function foldCodexTerminals(state: CodexTerminalState, records: TranscriptRecord[]): void {
  for (const record of records) {
    const payload = rec(record.payload)
    const kind = str(payload?.type)
    const ended = record.type === 'event_msg' && kind === 'item_completed' && endedTerminal(payload)
    if (ended) {
      end(state, ended.sessionId, ended.end)
      continue
    }
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
    const { running: sessionId, exited } = outcomeOf(payload.output)
    if (sessionId) {
      const had = state.terminals.get(sessionId)
      state.terminals.set(sessionId, {
        sessionId,
        command: had?.command ?? (call.command ? oneLine(call.command, 80) : null),
        startedAt: had?.startedAt ?? call.at,
        ended: null
      })
    } else if (call.polls && exited) {
      end(state, call.polls, exited)
    }
  }
}
