// Status an agent's own hooks wrote to disk, one state file per session.
import type {
  LiveSessionProvider,
  LiveSessionStatus
} from '../../../shared/live-sessions/live-session-types'
import { parseJsonRecord } from '../../../shared/live-sessions/transcript-json-record'
import { restingStatus } from './session-status'
import type { TranscriptSummary } from './transcript-summary'

/** A SISomewhere-format hook state file (`~/.config/sisomewhere/agents/<id>.json`). */
type HookState = {
  provider: LiveSessionProvider
  providerSessionId: string
  state: string
  detail: string | null
  updatedMs: number
  pid: number | null
}

export function parseHookStates(files: { path: string; text: string }[]): HookState[] {
  return files.flatMap(({ path, text }): HookState[] => {
    const raw = parseJsonRecord(text)
    if (!raw) {
      return []
    }
    const provider = raw.provider === 'codex' ? 'codex' : raw.provider ? null : 'claude'
    if (!provider || (raw.provider && raw.provider !== provider)) {
      return []
    }
    const fileId = (path.split('/').pop() ?? '').replace(/\.json$/, '')
    const id = typeof raw.id === 'string' && raw.id ? raw.id : fileId.replace(/^codex-/, '')
    const updated = typeof raw.updated === 'number' ? raw.updated * 1000 : 0
    return [
      {
        provider,
        providerSessionId: id,
        state: typeof raw.state === 'string' ? raw.state : '',
        detail: typeof raw.detail === 'string' && raw.detail ? raw.detail : null,
        updatedMs: updated,
        pid: typeof raw.pid === 'number' ? raw.pid : null
      }
    ]
  })
}

/** The transcript's record of a turn's end lands this long after the hook that reported the turn. */
const TURN_END_AFTER_HOOK_MS = 3_000

export function hookStatus(
  hook: Pick<HookState, 'state' | 'updatedMs'>,
  running: boolean,
  summary: TranscriptSummary | undefined,
  /** The host listed its processes and this agent is not among them, nor still writing. */
  gone: boolean
): LiveSessionStatus | null {
  // No hook fires for an interrupted turn, so the file still says `working` after the transcript
  // has recorded the turn's end.
  const endedSince =
    summary?.phase === 'turn-ended' &&
    summary.settled &&
    summary.lastAt !== null &&
    summary.lastAt > hook.updatedMs + TURN_END_AFTER_HOOK_MS
  switch (hook.state) {
    // An agent killed mid-turn or at its prompt never clears the file; it speaks for no one then.
    case 'working':
      return gone || endedSince ? null : 'working'
    case 'needs':
      return gone || endedSince ? null : 'needs-permission'
    case 'done':
    case 'idle':
      // The hook that closes a failed turn says `done` like any other: the failure stays the news.
      return running ? restingStatus(summary) : summary?.phase === 'errored' ? 'errored' : 'done'
    default:
      return null
  }
}
