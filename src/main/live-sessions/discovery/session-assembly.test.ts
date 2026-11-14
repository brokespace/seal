import { describe, expect, it } from 'vitest'
import type { LiveSessionMachine } from '../../../shared/live-sessions/live-session-types'
import { assembleHostSessions, type SummarizedTranscript } from './session-assembly'
import { UNKNOWN_TURN } from './transcript-summary'
import type { DiscoveredPane, DiscoveredProcess } from './discovery-output'

const machine: LiveSessionMachine = { hostId: 'ssh-1', label: 'build-box', kind: 'remote' }
const NOW = Date.parse('2026-11-13T12:00:00Z')
const RULE = '\u2500'.repeat(30)

function transcript(
  id: string,
  cwd: string,
  ageMs: number,
  phase: SummarizedTranscript['summary']['phase'] = 'turn-ended'
): SummarizedTranscript {
  return {
    path: `/home/b/.claude/projects/x/${id}.jsonl`,
    size: 100,
    mtimeMs: NOW - ageMs,
    summary: {
      ...UNKNOWN_TURN,
      settled: true,
      provider: 'claude',
      providerSessionId: id,
      cwd,
      title: `title ${id}`,
      phase,
      firstAt: NOW - 3_600_000,
      lastAt: NOW - ageMs,
      headless: false,
      recordIds: [],
      continues: [],
      parentSessionId: null,
      agentName: null,
      agentType: null
    }
  }
}

const proc = (
  pid: number,
  args: string,
  cwd: string,
  tty: string | null = null
): DiscoveredProcess => ({
  pid,
  ppid: 1,
  tty,
  args,
  cwd
})

const pane = (tty: string, screen: string): DiscoveredPane => ({
  socket: '/tmp/tmux-1000/default',
  paneId: '%4',
  tty,
  panePid: 900,
  name: 'claude',
  screen
})

function assemble(
  processes: DiscoveredProcess[],
  transcripts: SummarizedTranscript[],
  panes: DiscoveredPane[] = [],
  hookStates: { path: string; text: string }[] = [],
  claudeSessions: { pid: number; sessionId: string }[] = []
) {
  return assembleHostSessions({
    machine,
    output: { processes, panes, hookStates, hostNowMs: NOW, claudeSessions },
    transcripts,
    nowMs: NOW
  })
}

describe('assembleHostSessions', () => {
  it('pairs processes with transcripts by resumed id, then newest-to-newest in a shared folder', () => {
    const sessions = assemble(
      [
        proc(100, 'claude', '/srv/app'),
        proc(200, 'claude', '/srv/app'),
        proc(300, 'claude --resume 11111111-1111-4111-8111-111111111111', '/elsewhere')
      ],
      [
        transcript('11111111-1111-4111-8111-111111111111', '/srv/app', 60_000),
        transcript('22222222-2222-4222-8222-222222222222', '/srv/app', 30_000),
        transcript('33333333-3333-4333-8333-333333333333', '/srv/app', 10_000)
      ]
    )
    const pidOf = Object.fromEntries(sessions.map((s) => [s.providerSessionId, s.pid]))
    expect(pidOf).toEqual({
      '11111111-1111-4111-8111-111111111111': 300,
      '33333333-3333-4333-8333-333333333333': 200,
      '22222222-2222-4222-8222-222222222222': 100
    })
    expect(sessions.every((s) => s.id === `ssh-1:claude:${s.providerSessionId}`)).toBe(true)
  })

  it('pairs a process with the transcript it holds open before guessing by folder', () => {
    const old = transcript('44444444-4444-4444-8444-444444444444', '/srv/app', 3 * 86_400_000)
    const fresh = transcript('55555555-5555-4555-8555-555555555555', '/srv/app', 10_000)
    const sessions = assembleHostSessions({
      machine,
      output: {
        processes: [proc(100, 'claude', '/srv/app'), proc(200, 'claude', '/srv/app')],
        panes: [],
        hookStates: [],
        hostNowMs: NOW,
        pins: [{ pid: 200, kind: 'open', provider: 'claude', path: old.path }]
      },
      transcripts: [old, fresh],
      nowMs: NOW
    })
    expect(
      Object.fromEntries(sessions.map((s) => [s.providerSessionId, [s.pid, s.alive]]))
    ).toEqual({
      '44444444-4444-4444-8444-444444444444': [200, true],
      '55555555-5555-4555-8555-555555555555': [100, true]
    })
  })

  it('keeps only the outermost agent process', () => {
    const sessions = assemble(
      [
        {
          ...proc(100, 'node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js', '/srv/app'),
          ppid: 50
        },
        { ...proc(101, 'claude mcp-server', '/srv/app'), ppid: 100 }
      ],
      []
    )
    expect(sessions.map((s) => [s.providerSessionId, s.status, s.alive])).toEqual([
      ['pid-100', 'idle', true]
    ])
  })

  it('offers resume only for closed sessions and tmux only for live ones in a pane', () => {
    const [closed] = assemble(
      [],
      [transcript('44444444-4444-4444-8444-444444444444', '/srv/app', 3_600_000)]
    )
    expect(closed).toMatchObject({
      alive: false,
      status: 'done',
      inputRoutes: [{ kind: 'resume' }]
    })

    const [live] = assemble(
      [proc(100, 'claude', '/srv/app', 'pts/3')],
      [transcript('55555555-5555-4555-8555-555555555555', '/srv/app', 1_000)],
      [pane('pts/3', [RULE, '\u276f ', RULE].join('\n'))]
    )
    expect(live.inputRoutes).toEqual([
      { kind: 'tmux', target: '%4', socket: '/tmp/tmux-1000/default' }
    ])
    expect(live.status).toBe('idle')
  })

  it("names a fresh Claude from Claude's session registry and skips daemons and tool commands", () => {
    const id = '88888888-8888-4888-8888-888888888888'
    const sessions = assemble(
      [
        proc(100, 'claude', '/srv/app'),
        proc(200, '/opt/codex/bin/codex app-server --listen unix://', '/'),
        proc(300, 'claude mcp list', '/srv/app'),
        proc(400, 'node /usr/lib/node_modules/@openai/codex/bin/codex.js queue --thread x', '/')
      ],
      [],
      [],
      [],
      [{ pid: 100, sessionId: id }]
    )
    expect(sessions.map((s) => [s.providerSessionId, s.pid])).toEqual([[id, 100]])
  })

  it("routes a live Codex session through its own queue first, with that session's binary and home", () => {
    const id = '99999999-9999-4999-8999-999999999999'
    const rollout: SummarizedTranscript = {
      ...transcript(id, '/srv/api', 1_000),
      path: `/home/b/.codex-work/sessions/2026/11/13/rollout-2026-11-13T10-00-00-${id}.jsonl`,
      summary: { ...transcript(id, '/srv/api', 1_000).summary, provider: 'codex' }
    }
    const [session] = assemble(
      [proc(100, '/opt/codex/bin/codex', '/srv/api', 'pts/3')],
      [rollout],
      [pane('pts/3', '\u203a Ask Codex')]
    )
    expect(session.inputRoutes).toEqual([
      {
        kind: 'codex-queue',
        thread: id,
        binary: '/opt/codex/bin/codex',
        codexHome: '/home/b/.codex-work'
      },
      { kind: 'tmux', target: '%4', socket: '/tmp/tmux-1000/default' }
    ])
  })

  it('takes a permission dialog on screen over hooks and the transcript', () => {
    const id = '66666666-6666-4666-8666-666666666666'
    const [session] = assemble(
      [proc(100, 'claude', '/srv/app', 'pts/3')],
      [transcript(id, '/srv/app', 1_000, 'tool-pending')],
      [pane('pts/3', ['Do you want to proceed?', '\u276f 1. Yes', '  2. No (esc)'].join('\n'))],
      [{ path: '/h/a.json', text: JSON.stringify({ id, state: 'working', updated: NOW / 1000 }) }]
    )
    expect(session.status).toBe('needs-permission')
    expect(session.statusSource).toBe('screen')
    expect(session.permission?.question).toBe('Do you want to proceed?')
    expect(session.permission?.options).toEqual([
      { id: '1', label: 'Yes' },
      { id: '2', label: 'No' }
    ])
  })

  it('uses a fresh hook state over the transcript phase', () => {
    const id = '77777777-7777-4777-8777-777777777777'
    const [session] = assemble(
      [proc(100, 'claude', '/srv/app')],
      [transcript(id, '/srv/app', 5_000, 'working')],
      [],
      [{ path: '/h/a.json', text: JSON.stringify({ id, state: 'needs', updated: NOW / 1000 }) }]
    )
    expect(session).toMatchObject({ status: 'needs-permission', statusSource: 'agent-hooks' })
  })
})
