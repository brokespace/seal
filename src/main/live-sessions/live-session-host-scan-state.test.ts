import { afterEach, expect, it, vi } from 'vitest'
import type { LiveSessionHost } from './hosts/live-session-hosts'
import { LiveSessionRegistry } from './live-session-registry'

afterEach(() => {
  vi.useRealTimers()
})

// Agents started in a terminal outside Seal: no pane or hook says so, only the process list.
it.each([
  ['started', [], [4100], [[4100, 'idle']]],
  ['ended', [4100], [], []],
  ['was replaced by another', [4100], [4200], [[4200, 'idle']]]
])(
  'an agent that %s on this machine after a quiet minute shows within one scan interval',
  async (_, before, after, listed) => {
    vi.useFakeTimers()
    let agents = before
    const host: LiveSessionHost = {
      machine: { hostId: 'local', label: 'dev-box', kind: 'local' },
      run: async () =>
        [
          `@@NOW ${Math.floor(Date.now() / 1000)}`,
          ...agents.flatMap((pid) => [`@@PROC ${pid} 1 pts/3 claude`, `@@CWD ${pid} /srv/shop`]),
          '@@PS',
          '@@DONE'
        ].join('\n'),
      transcriptFiles: async () => []
    }
    const registry = new LiveSessionRegistry({
      localMachine: host.machine,
      hosts: () => [host],
      sealPanes: () => [],
      intervalsMs: { local: 3_000, ssh: 8_000 }
    })
    registry.start()
    try {
      await vi.advanceTimersByTimeAsync(60_000)
      agents = after
      await vi.advanceTimersByTimeAsync(3_000)
      expect(registry.getSnapshot().sessions.map((s) => [s.pid, s.status])).toEqual(listed)
    } finally {
      registry.stop()
    }
  }
)
