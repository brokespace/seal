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

export function hookStatus(
  state: string,
  running: boolean,
  summary: TranscriptSummary | undefined,
  /** The host listed its processes and this agent is not among them, nor still writing. */
  gone: boolean
): LiveSessionStatus | null {
  switch (state) {
    // An agent killed mid-turn or at its prompt never clears the file; it speaks for no one then.
    case 'working':
      return gone ? null : 'working'
    case 'needs':
      return gone ? null : 'needs-permission'
    case 'done':
    case 'idle':
      return running ? restingStatus(summary) : 'done'
    default:
      return null
  }
}
