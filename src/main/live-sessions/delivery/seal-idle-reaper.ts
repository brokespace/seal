import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import type { LiveSessionHost } from '../hosts/live-session-hosts'
import { isSealTmuxSocket } from './session-removal'

export const DEFAULT_IDLE_REAP_MINUTES = 120
const SWEEP_EVERY_MS = 10 * 60_000

/** `liveSessionsIdleReapMinutes`: unset is the default, 0 or less turns the reaper off. */
export function idleReapMinutes(setting: number | undefined): number | null {
  const minutes = setting ?? DEFAULT_IDLE_REAP_MINUTES
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null
}

/**
 * Ends `tmux -L seal` wrapper sessions no terminal shows and nobody has typed into for `idleS`.
 * Only Seal's own socket: the user's tmux servers and unwrapped agents are never touched.
 */
export function sealIdleReapScript(idleS: number): string {
  return `command -v tmux >/dev/null 2>&1 || exit 0
now=$(date +%s)
tmux -L seal list-sessions -F '#{session_attached} #{session_activity} #{session_name}' 2>/dev/null |
while read -r attached activity name; do
  [ "$attached" = 0 ] || continue
  [ $((now - activity)) -ge ${Math.max(0, Math.floor(idleS))} ] || continue
  tmux -L seal kill-session -t "=$name" 2>/dev/null && echo "@@REAPED $name"
done
exit 0
`
}

export function reapedSessions(out: string): string[] {
  return out
    .split('\n')
    .filter((line) => line.startsWith('@@REAPED '))
    .map((line) => line.slice('@@REAPED '.length).trim())
}

/**
 * Sweeps a host after a registry scan that found an agent in Seal's tmux server, at most every
 * SWEEP_EVERY_MS; with no such agent there is nothing to end, so nothing runs.
 */
export class SealIdleReaper {
  private readonly lastSweep = new Map<string, number>()

  constructor(
    private readonly deps: {
      minutes: () => number | null
      now?: () => number
      log?: (message: string, error?: unknown) => void
    }
  ) {}

  onHostScanned(host: LiveSessionHost, sessions: readonly LiveSession[]): void {
    const hostId = host.machine.hostId
    const now = (this.deps.now ?? Date.now)()
    const inSealTmux = sessions.some((session) =>
      session.inputRoutes.some((route) => route.kind === 'tmux' && isSealTmuxSocket(route.socket))
    )
    if (!inSealTmux || now - (this.lastSweep.get(hostId) ?? -Infinity) < SWEEP_EVERY_MS) {
      return
    }
    this.lastSweep.set(hostId, now)
    void this.sweep(host)
  }

  async sweep(host: LiveSessionHost): Promise<string[]> {
    const minutes = this.deps.minutes()
    if (minutes === null) {
      return []
    }
    try {
      const names = reapedSessions(await host.run(sealIdleReapScript(minutes * 60)))
      if (names.length > 0) {
        this.deps.log?.(`[live-sessions] ended idle Seal sessions on ${host.machine.label}`, names)
      }
      return names
    } catch (error) {
      this.deps.log?.(`[live-sessions] idle sweep of ${host.machine.label} failed`, error)
      return []
    }
  }
}
