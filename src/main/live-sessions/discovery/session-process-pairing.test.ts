import { describe, expect, it } from 'vitest'
import type { LiveSessionMachine } from '../../../shared/live-sessions/live-session-types'
import type { DiscoveredPane, DiscoveredProcess } from './discovery-output'
import { assembleHostSessions, type SummarizedTranscript } from './session-assembly'
import { summarizeClaudeTranscript, summarizeCodexRollout } from './transcript-summary'

const machine: LiveSessionMachine = { hostId: 'ssh-1', label: 'build-box', kind: 'remote' }
const NOW = Date.parse('2026-11-13T12:00:00Z')
const ROLLOUT_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
const CLAUDE_ID = 'cccccccc-0000-4000-8000-000000000003'
const PANE: DiscoveredPane = {
  socket: '/tmp/tmux-1000/default',
  paneId: '%1',
  tty: 'pts/3',
  panePid: 1,
  name: 'main:0.0',
  screen: null
}

/** A Codex rollout in `/srv/api`, last written `ageMs` ago. */
function rollout(ageMs: number, agentPid?: number): SummarizedTranscript {
  const path = `/home/dev/.codex/sessions/2026/11/13/rollout-2026-11-13T11-00-00-${ROLLOUT_ID}.jsonl`
  const at = new Date(NOW - ageMs).toISOString()
  const text = [
    { type: 'session_meta', timestamp: at, payload: { id: ROLLOUT_ID, cwd: '/srv/api' } },
    { type: 'event_msg', timestamp: at, payload: { type: 'user_message', message: 'Add a cache' } },
    { type: 'event_msg', timestamp: at, payload: { type: 'task_complete' } }
  ]
    .map((record) => JSON.stringify(record))
    .join('\n')
  return {
    path,
    size: text.length,
    mtimeMs: NOW - ageMs,
    summary: summarizeCodexRollout({ path, head: text, tail: text, tailIsWholeFile: true }),
    ...(agentPid === undefined ? {} : { agentPid })
  }
}

/** A Codex in the tmux pane, started `ranForMs` ago. */
const codex = (pid: number, cwd: string | null, ranForMs: number): DiscoveredProcess => ({
  pid,
  ppid: 1,
  tty: PANE.tty,
  args: 'codex',
  cwd,
  startedAtMs: NOW - ranForMs
})

function listed(processes: DiscoveredProcess[], transcripts: SummarizedTranscript[]) {
  return assembleHostSessions({
    machine,
    output: { processes, panes: [PANE], hookStates: [], hostNowMs: NOW, processesListed: true },
    transcripts,
    nowMs: NOW
  }).map((s) => ({
    id: s.providerSessionId,
    pid: s.pid,
    routes: s.inputRoutes.map((route) => route.kind)
  }))
}

describe('which agent a transcript belongs to, when nothing names it', () => {
  it('is the agent in its folder that was running when it was last written', () => {
    expect(listed([codex(4200, '/srv/api', 600_000)], [rollout(10_000)])).toEqual([
      { id: ROLLOUT_ID, pid: 4200, routes: ['codex-queue', 'tmux'] }
    ])
  })

  // One Codex exits and another starts in its folder within two minutes, before its first prompt.
  it('is not an agent that started after it was last written', () => {
    expect(listed([codex(4200, '/srv/api', 30_000)], [rollout(60_000)])).toEqual([
      { id: 'pid-4200', pid: 4200, routes: ['tmux'] },
      { id: ROLLOUT_ID, pid: null, routes: [] }
    ])
  })

  // The second Codex was already open, unprompted, when the first wrote its last record and left.
  it('is not an agent other than the one seen writing it', () => {
    expect(listed([codex(4200, '/srv/api', 600_000)], [rollout(10_000, 4100)])).toEqual([
      { id: 'pid-4200', pid: 4200, routes: ['tmux'] },
      { id: ROLLOUT_ID, pid: null, routes: ['resume'] }
    ])
  })

  it('is not an agent in another folder, however fresh the transcript', () => {
    const path = `/home/dev/.claude/projects/-w/${CLAUDE_ID}.jsonl`
    const text = JSON.stringify({
      type: 'user',
      uuid: 'c1',
      parentUuid: null,
      cwd: '/w',
      timestamp: new Date(NOW - 5_000).toISOString(),
      message: { role: 'user', content: 'Deploy it' }
    })
    const transcript: SummarizedTranscript = {
      path,
      size: text.length,
      mtimeMs: NOW - 5_000,
      summary: summarizeClaudeTranscript({ path, head: text, tail: text, tailIsWholeFile: true })
    }
    const claude = { ...codex(812, '/w/sub', 600_000), args: 'claude' }
    expect(listed([claude], [transcript])).toEqual([
      { id: 'pid-812', pid: 812, routes: ['tmux'] },
      { id: CLAUDE_ID, pid: null, routes: [] }
    ])
  })

  // Another user's process: its folder cannot be read. It may be the writer, or a bystander.
  it('gets no way into the one agent whose folder is unknown, and that agent is not listed twice', () => {
    expect(listed([codex(4200, null, 600_000)], [rollout(10_000)])).toEqual([
      { id: ROLLOUT_ID, pid: null, routes: [] }
    ])
  })
})
