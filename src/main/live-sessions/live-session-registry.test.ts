import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveSessionRegistryEvent } from '../../shared/live-sessions/live-session-types'
import type { DiscoveredFile } from './discovery/discovery-output'
import type { LiveSessionHost } from './hosts/live-session-hosts'
import { LiveSessionAnnotations } from './live-session-annotations'
import { LiveSessionRegistry } from './live-session-registry'
import type { SealPane } from './seal-panes/seal-pane-sessions'

const NOW = Date.parse('2026-11-13T21:00:00Z')
const DIR = '/home/dev/.claude/projects/-srv-shop'
const WORKING = '04186322-14da-4a67-890c-c5f4a754e99f'
const ERRORED = 'e503cd0b-d59c-4221-a949-3c685cf99554'
const FORK = '7f01a62c-a158-4451-a43b-a2e253ed713e'

function transcript(
  fixture: string,
  sessionId: string,
  ageMs: number,
  records = Infinity
): DiscoveredFile {
  const lines = readFileSync(join(__dirname, fixture), 'utf8').split('\n')
  const text = lines.slice(0, records).join('\n')
  return {
    provider: 'claude',
    path: `${DIR}/${sessionId}.jsonl`,
    size: Buffer.byteLength(text),
    mtimeMs: NOW - ageMs,
    head: text,
    tail: text
  }
}

/** A machine whose processes, transcripts and Seal panes the test changes between scans. */
function machine(clock: () => number = () => NOW) {
  const state: {
    running: boolean
    /** The folder the running agent is in. */
    cwd: string
    files: DiscoveredFile[]
    panes: SealPane[]
    /** The machine stopped answering: its scans fail. */
    down: boolean
    /** The scan's shell dies before it lists a process. */
    cutShort: boolean
    /** The machine left the list of connected machines. */
    disconnected: boolean
  } = {
    running: false,
    cwd: '/srv/shop',
    files: [],
    panes: [],
    down: false,
    cutShort: false,
    disconnected: false
  }
  const host: LiveSessionHost = {
    machine: { hostId: 'local', label: 'dev-box', kind: 'local' },
    run: async () => {
      if (state.down) {
        throw new Error('ssh: connect to host dev-box: Connection timed out')
      }
      if (state.cutShort) {
        return `@@NOW ${Math.floor(NOW / 1000)}`
      }
      return [
        `@@NOW ${Math.floor(NOW / 1000)}`,
        // Started before any transcript here began.
        ...(state.running
          ? ['@@PROC 4100 1 pts/3 claude', `@@CWD 4100 ${state.cwd}`, '@@AGE 4100 900-00:00:00']
          : []),
        '@@DONE'
      ].join('\n')
    },
    transcriptFiles: async () => state.files
  }
  const events: LiveSessionRegistryEvent[] = []
  const paneListeners = new Set<() => void>()
  const registry = new LiveSessionRegistry({
    localMachine: host.machine,
    hosts: () => (state.disconnected ? [] : [host]),
    sealPanes: () => state.panes,
    subscribeSealPanes: (onChange) => {
      paneListeners.add(onChange)
      return () => paneListeners.delete(onChange)
    },
    intervalsMs: { local: 60_000, ssh: 60_000 },
    now: clock
  })
  /** A hook event changed a pane. */
  const paneChanged = (panes: SealPane[]) => {
    state.panes = panes
    paneListeners.forEach((listener) => listener())
  }
  registry.subscribe((event) => events.push(event))
  const rows = async () => {
    await registry.refresh()
    return registry.getSnapshot().sessions.map((s) => [s.id, s.origin, s.pid])
  }
  const replaced = () =>
    events.flatMap((e) =>
      e.type === 'remove' && e.replacedBy ? [[e.sessionId, e.replacedBy]] : []
    )
  return { state, registry, rows, replaced, paneChanged, events }
}

const sealPane: SealPane = {
  paneKey: 'tab-1:0',
  provider: 'claude',
  providerSessionId: WORKING,
  connectionId: null,
  status: 'working',
  statusDetail: null,
  cwd: '/srv/shop',
  transcriptPath: `${DIR}/${WORKING}.jsonl`,
  prompt: 'Why does checkout double-charge when the cart has a coupon?',
  lastMessage: null,
  receivedAt: NOW - 1_000,
  permission: null,
  silent: false
}

describe('one row per agent session', () => {
  it('keeps an agent Seal launched as one row from its first sighting to its first prompt', async () => {
    const { state, registry, rows, replaced } = machine()
    state.running = true
    expect(await rows()).toEqual([['local:claude:pid-4100', 'external', 4100]])

    // Seal's hooks name the session before its transcript exists.
    state.panes = [sealPane]
    expect(await rows()).toEqual([[`local:claude:${WORKING}`, 'seal', 4100]])

    state.files = [transcript('discovery/__fixtures__/claude-working.jsonl', WORKING, 2_000)]
    expect(await rows()).toEqual([[`local:claude:${WORKING}`, 'seal', 4100]])
    expect(replaced()).toEqual([['local:claude:pid-4100', `local:claude:${WORKING}`]])
    expect(registry.get('local:claude:pid-4100')?.inputRoutes).toEqual([
      { kind: 'seal-pane', paneKey: 'tab-1:0' }
    ])
  })

  it('answers for an agent by its own id once it is listed apart from the session it was taken for', async () => {
    const { state, registry, rows } = machine()
    state.running = true
    await rows()
    state.panes = [sealPane]
    expect(await rows()).toEqual([[`local:claude:${WORKING}`, 'seal', 4100]])

    // The pane's session was another agent's: this one is listed under its own id again.
    state.panes = []
    expect(await rows()).toEqual([['local:claude:pid-4100', 'external', 4100]])
    expect(registry.get('local:claude:pid-4100')?.id).toBe('local:claude:pid-4100')
  })

  it('keeps an agent started outside Seal as one row once Seal also sees it in a pane', async () => {
    const { state, rows } = machine()
    state.running = true
    state.files = [transcript('discovery/__fixtures__/claude-working.jsonl', WORKING, 2_000)]
    expect(await rows()).toEqual([[`local:claude:${WORKING}`, 'external', 4100]])

    state.panes = [sealPane]
    expect(await rows()).toEqual([[`local:claude:${WORKING}`, 'seal', 4100]])
  })

  it('keeps a session resumed into a new transcript after an error as the same row', async () => {
    const { state, registry, rows, replaced } = machine()
    state.files = [
      transcript(
        'transcripts/__fixtures__/claude-2.1.325-error-then-continue.jsonl',
        ERRORED,
        120_000
      )
    ]
    expect(await rows()).toEqual([[`local:claude:${ERRORED}`, 'external', null]])

    state.files = [
      ...state.files,
      transcript('transcripts/__fixtures__/claude-2.1.325-fork-of-errored.jsonl', FORK, 60_000)
    ]
    expect(await rows()).toEqual([[`local:claude:${FORK}`, 'external', null]])
    expect(replaced()).toEqual([[`local:claude:${ERRORED}`, `local:claude:${FORK}`]])
    expect(registry.get(`local:claude:${ERRORED}`)?.id).toBe(`local:claude:${FORK}`)
  })

  it('keeps the name and pin of a session that was resumed into a new transcript', async () => {
    const annotations = new LiveSessionAnnotations(join('/nonexistent', 'annotations.json'))
    annotations.set({
      sessionId: `local:claude:${ERRORED}`,
      customTitle: 'Failing build',
      pinned: true
    })
    const { state, registry } = machine()
    state.files = [
      transcript(
        'transcripts/__fixtures__/claude-2.1.325-error-then-continue.jsonl',
        ERRORED,
        120_000
      ),
      transcript('transcripts/__fixtures__/claude-2.1.325-fork-of-errored.jsonl', FORK, 60_000)
    ]
    await registry.refresh()
    const [session] = registry.getSnapshot().sessions.map((s) => annotations.apply(s))
    expect([session.id, session.customTitle, session.pinned]).toEqual([
      `local:claude:${FORK}`,
      'Failing build',
      true
    ])
  })
})

describe('a machine that stops answering', () => {
  it('stops vouching for its sessions after three failed scans, and shows them again once it answers', async () => {
    const { state, registry } = machine()
    state.running = true
    state.files = [transcript('discovery/__fixtures__/claude-working.jsonl', WORKING, 2_000)]
    const shown = async () => {
      await registry.refresh()
      const { sessions, hostErrors } = registry.getSnapshot()
      return { statuses: sessions.map((s) => s.status), error: hostErrors.local ?? null }
    }
    expect(await shown()).toEqual({ statuses: ['working'], error: null })

    state.down = true
    const timedOut = 'ssh: connect to host dev-box: Connection timed out'
    // One or two lost scans are a hiccup: the last reading stands.
    expect(await shown()).toEqual({ statuses: ['working'], error: timedOut })
    expect(await shown()).toEqual({ statuses: ['working'], error: timedOut })
    expect(await shown()).toEqual({ statuses: [], error: timedOut })

    state.down = false
    expect(await shown()).toEqual({ statuses: ['working'], error: null })
  })

  // This machine's transcripts are read by Seal itself, so they are listed whatever the shell did.
  it('does not take a scan that broke off before the process list as word that its agents left', async () => {
    const { state, registry } = machine()
    state.running = true
    state.files = [transcript('discovery/__fixtures__/claude-working.jsonl', WORKING, 2_000)]
    const told = async () => {
      await registry.refresh()
      return {
        alive: registry.getSnapshot().sessions.map((s) => s.alive),
        read: registry.hasRead(`local:claude:${WORKING}`)
      }
    }
    state.cutShort = true
    expect(await told()).toEqual({ alive: [], read: false })

    state.cutShort = false
    expect(await told()).toEqual({ alive: [true], read: true })

    state.cutShort = true
    expect(await told()).toEqual({ alive: [true], read: true })
  })

  it('tells its listeners the error is gone when the machine disconnects', async () => {
    const { state, registry, events } = machine()
    state.down = true
    await registry.refresh()
    state.disconnected = true
    await registry.refresh()

    expect(events.flatMap((e) => (e.type === 'host-error' ? [[e.hostId, e.error]] : []))).toEqual([
      ['local', 'ssh: connect to host dev-box: Connection timed out'],
      ['local', null]
    ])
  })
})

describe('a Seal pane whose status changes between scans', () => {
  afterEach(() => vi.useRealTimers())

  it('reads its machine again at once, not a scan later', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const { state, registry, paneChanged } = machine(() => Date.now())
    const shown = () => registry.getSnapshot().sessions.map((s) => s.status)
    const recorded = 'discovery/__fixtures__/live-claude-background-command-finished.jsonl'
    state.running = true
    state.cwd = '/tmp/cc-home/work'
    state.files = [transcript(recorded, WORKING, 0, 7)]
    state.panes = [{ ...sealPane, status: 'your-turn' }]
    registry.start()
    try {
      await vi.advanceTimersByTimeAsync(1_000)
      expect(shown()).toEqual(['waiting-task'])

      // The command ends and wakes Claude, which answers and stops again.
      state.files = [transcript(recorded, WORKING, 0)]
      paneChanged([{ ...sealPane, status: 'working' }])
      paneChanged([{ ...sealPane, status: 'your-turn' }])
      // The scan that read the command as running is a minute from its next.
      await vi.advanceTimersByTimeAsync(1_000)
      expect(shown()).toEqual(['your-turn'])
    } finally {
      registry.stop()
    }
  })
})
