import {
  liveSessionProviderOf,
  type LiveSession,
  type LiveTakeOverResult
} from '../../../shared/live-sessions/live-session-types'
import { codexHomeOf } from '../discovery/agent-processes'
import type { LiveSessionHost } from '../hosts/live-session-hosts'

/** True while process `$1` runs. A zombie has exited, yet `kill -0` finds it until its parent reaps it. */
const RUNS = `runs() {
  s=$(ps -o stat= -p "$1" 2>/dev/null) || { kill -0 "$1" 2>/dev/null; return; }
  case $s in ''|Z*) return 1 ;; esac
}`

/**
 * SIGTERM lets the agent flush its transcript; SIGKILL only if it ignores that for 5s. `thenRun`
 * runs after the signals and before the verdict, which is also left in `$stopped` (1 or 0).
 */
export function stopAgentScript(
  pid: number,
  provider: LiveSession['provider'],
  thenRun = ''
): string {
  return `p=${pid}
${RUNS}
signalled=0
case $(ps -o args= -p "$p" 2>/dev/null) in
  *${provider}*)
    signalled=1
    kill -TERM "$p" 2>/dev/null
    i=0
    while runs "$p" && [ $i -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
    runs "$p" && kill -KILL "$p" 2>/dev/null ;;
esac
${thenRun}
i=0
while [ $signalled = 1 ] && runs "$p" && [ $i -lt 10 ]; do sleep 0.1; i=$((i + 1)); done
if [ $signalled = 1 ] && runs "$p"; then stopped=0; echo @@ALIVE; else stopped=1; echo @@STOPPED; fi
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
  const provider = liveSessionProviderOf(session.provider)
  if (!provider || !session.capabilities.takeOver) {
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
    provider,
    providerSessionId: session.providerSessionId,
    cwd: session.cwd,
    machine: session.machine,
    transcriptPath: session.transcriptPath,
    codexHome: session.provider === 'codex' ? codexHomeOf(session.transcriptPath) : null
  }
}
