import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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

function transcript(fixture: string, sessionId: string, ageMs: number): DiscoveredFile {
  const text = readFileSync(join(__dirname, fixture), 'utf8')
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
function machine() {
  const state: { running: boolean; files: DiscoveredFile[]; panes: SealPane[] } = {
    running: false,
    files: [],
    panes: []
  }
  const host: LiveSessionHost = {
    machine: { hostId: 'local', label: 'dev-box', kind: 'local' },
    run: async () =>
      [
        `@@NOW ${Math.floor(NOW / 1000)}`,
        ...(state.running ? ['@@PROC 4100 1 pts/3 claude', '@@CWD 4100 /srv/shop'] : []),
        '@@DONE'
      ].join('\n'),
    transcriptFiles: async () => state.files
  }
  const events: LiveSessionRegistryEvent[] = []
  const registry = new LiveSessionRegistry({
    localMachine: host.machine,
    hosts: () => [host],
    sealPanes: () => state.panes,
    now: () => NOW
  })
  registry.subscribe((event) => events.push(event))
  const rows = async () => {
    await registry.refresh()
    return registry.getSnapshot().sessions.map((s) => [s.id, s.origin, s.pid])
  }
  const replaced = () =>
    events.flatMap((e) =>
      e.type === 'remove' && e.replacedBy ? [[e.sessionId, e.replacedBy]] : []
    )
  return { state, registry, rows, replaced }
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
  receivedAt: NOW - 1_000,
  permission: null
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
