// Claude Code's own record of a running session (`~/.claude/sessions/<pid>.json`): which
// conversation the process is in and, on builds that write it, what the process is doing.
import type { LiveSessionStatus } from '../../../shared/live-sessions/live-session-types'
import { isRestingLiveSessionStatus } from '../../../shared/live-sessions/live-session-status'
import type { StatusAndDetail } from './session-status'
import type { TranscriptRecord } from './transcript-records'
import type { TranscriptTurn } from './transcript-summary'

/**
 * busy     a turn runs, or work the agent delegated does
 * idle     at its prompt, nothing of its own running
 * shell    at its prompt while commands it left in the background still run
 * waiting  a dialog holds it until the user answers (`waitingFor` says which)
 */
export const CLAUDE_REGISTRY_STATES = ['busy', 'idle', 'shell', 'waiting'] as const
export type ClaudeRegistryState = (typeof CLAUDE_REGISTRY_STATES)[number]

export type ClaudeRegistryEntry = {
  pid: number
  sessionId: string
  /** Null on builds that only name the session. */
  state: ClaudeRegistryState | null
  waitingFor: string | null
  /** When the state was written, on the host's clock. */
  stateAtMs: number | null
}

export function parseClaudeRegistryEntry(
  record: TranscriptRecord | null
): ClaudeRegistryEntry | null {
  if (!record || typeof record.pid !== 'number' || typeof record.sessionId !== 'string') {
    return null
  }
  const state = CLAUDE_REGISTRY_STATES.find((known) => known === record.status) ?? null
  const stamp = record.statusUpdatedAt ?? record.updatedAt
  return {
    pid: record.pid,
    sessionId: record.sessionId,
    state,
    waitingFor:
      typeof record.waitingFor === 'string' && record.waitingFor ? record.waitingFor : null,
    stateAtMs: typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : null
  }
}

/** Dialogs the user opened themselves (`/model`, `/config`): the agent asked for nothing. */
const OWN_DIALOGS: ReadonlySet<string> = new Set(['dialog open'])
const QUESTIONS: ReadonlySet<string> = new Set(['input needed', 'goal proposal'])
/** The transcript lands a moment after the state it records; a state stamped later than this is newer. */
const STATE_AFTER_WRITE_MS = 2_000

/** What the agent says of commands it left running: null when it says nothing either way. */
export function claudeRegistryBackgroundShells(
  entry: ClaudeRegistryEntry | null
): 'running' | 'none' | null {
  if (entry?.state === 'shell') {
    return 'running'
  }
  return entry?.state === 'idle' ? 'none' : null
}

/**
 * The agent's own word on a dialog that holds it, and on a turn the transcript left open that
 * the agent has since dropped (an interrupt that wrote nothing).
 */
export function withClaudeRegistryState(
  current: StatusAndDetail,
  turn: TranscriptTurn | undefined,
  entry: ClaudeRegistryEntry | null,
  lastWriteMs: number
): StatusAndDetail | null {
  if (!entry?.state || entry.state === 'busy') {
    return null
  }
  if (entry.state === 'waiting') {
    if (turn?.phase === 'input-requested' || OWN_DIALOGS.has(entry.waitingFor ?? '')) {
      return null
    }
    const status: LiveSessionStatus = QUESTIONS.has(entry.waitingFor ?? '')
      ? 'waiting-input'
      : 'needs-permission'
    return status === current.status ? null : { status, statusDetail: current.statusDetail }
  }
  const leftOpen = current.status === 'working' || current.status === 'needs-permission'
  const stampedLater =
    entry.stateAtMs !== null && entry.stateAtMs > lastWriteMs + STATE_AFTER_WRITE_MS
  return leftOpen && stampedLater ? { status: 'your-turn', statusDetail: null } : null
}

/** A turn the transcript ended that the agent still calls busy: compaction, or work it delegated. */
export function claudeRegistryHoldsBusy(
  current: StatusAndDetail,
  turn: TranscriptTurn | undefined,
  entry: ClaudeRegistryEntry | null
): boolean {
  const resting =
    isRestingLiveSessionStatus(current.status) ||
    (current.status === 'waiting-input' && turn?.phase !== 'input-requested')
  return entry?.state === 'busy' && resting
}
