import type {
  LiveSession,
  LiveTakeOverResult
} from '../../../shared/live-sessions/live-session-types'
import { codexHomeOf } from '../discovery/agent-processes'
import type { LiveSessionHost } from '../hosts/live-session-hosts'

/** SIGTERM lets the agent flush its transcript; SIGKILL only if it ignores that for 5s. */
export function stopAgentScript(pid: number, provider: LiveSession['provider']): string {
  return `p=${pid}
case $(ps -o args= -p "$p" 2>/dev/null) in
  *${provider}*) ;;
  *) echo @@STOPPED; exit 0 ;;
esac
kill -TERM "$p" 2>/dev/null
i=0
while kill -0 "$p" 2>/dev/null && [ $i -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
if kill -0 "$p" 2>/dev/null; then kill -KILL "$p" 2>/dev/null; sleep 0.3; fi
if kill -0 "$p" 2>/dev/null; then echo @@ALIVE; else echo @@STOPPED; fi
`
}

export async function takeOverSession(
  session: LiveSession | null,
  host: LiveSessionHost | null
): Promise<LiveTakeOverResult> {
  if (!session || !host) {
    return { ok: false, reason: 'not_found' }
  }
  if (session.origin !== 'external') {
    return { ok: false, reason: 'not_external' }
  }
  // Without the transcript's id there is nothing for `--resume` to reopen.
  if (session.providerSessionId.startsWith('pid-')) {
    return { ok: false, reason: 'not_resumable' }
  }
  if (session.alive && session.pid !== null) {
    const out = await host.run(stopAgentScript(session.pid, session.provider))
    if (!out.includes('@@STOPPED')) {
      return { ok: false, reason: 'still_running' }
    }
  }
  return {
    ok: true,
    provider: session.provider,
    providerSessionId: session.providerSessionId,
    cwd: session.cwd,
    machine: session.machine,
    transcriptPath: session.transcriptPath,
    codexHome: session.provider === 'codex' ? codexHomeOf(session.transcriptPath) : null
  }
}
