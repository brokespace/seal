import type { LiveSessionHost } from '../hosts/live-session-hosts'

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

/** Sweeps every connected host on a timer; a host that fails is retried on the next sweep. */
export class SealIdleReaper {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly deps: {
      hosts: () => LiveSessionHost[]
      minutes: () => number | null
      log?: (message: string, error?: unknown) => void
    }
  ) {}

  start(): void {
    this.timer ??= setInterval(() => void this.sweep(), SWEEP_EVERY_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async sweep(): Promise<string[]> {
    const minutes = this.deps.minutes()
    if (minutes === null) {
      return []
    }
    const reaped: string[] = []
    for (const host of this.deps.hosts()) {
      try {
        const names = reapedSessions(await host.run(sealIdleReapScript(minutes * 60)))
        if (names.length > 0) {
          this.deps.log?.(
            `[live-sessions] ended idle Seal sessions on ${host.machine.label}`,
            names
          )
        }
        reaped.push(...names)
      } catch (error) {
        this.deps.log?.(`[live-sessions] idle sweep of ${host.machine.label} failed`, error)
      }
    }
    return reaped
  }
}
