import { spawn } from 'node:child_process'
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  utimes,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localHost, type LiveSessionHost } from '../hosts/live-session-hosts'
import { HostSessionScanner, LOCAL_SCAN_LIMITS } from './host-session-scanner'
import { aiVaultTranscriptFiles } from './local-transcript-files'

const CLAUDE_ID = '0b5f0c7e-1111-4222-8333-944445555666'
const CODEX_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
const line = (record: unknown) => `${JSON.stringify(record)}\n`

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'seal-scan-'))
  vi.stubEnv('HOME', home)
  vi.stubEnv('CLAUDE_CONFIG_DIR', '')
  vi.stubEnv('CODEX_HOME', '')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})

// An SSH exec that lost its connection mid-output: the processes arrived, the transcripts did not.
it('keeps a session under its id, and adds no nameless one, when a scan is cut short', async () => {
  const path = `/home/dev/.codex/sessions/2026/11/13/rollout-2026-11-13T10-00-00-${CODEX_ID}.jsonl`
  const at = '2026-11-13T10:00:00.000Z'
  const text =
    line({ type: 'session_meta', timestamp: at, payload: { id: CODEX_ID, cwd: '/srv/api' } }) +
    line({ type: 'event_msg', timestamp: at, payload: { type: 'task_started' } })
  const b64 = Buffer.from(text).toString('base64')
  const now = Date.parse(at) + 20_000
  const processes = [
    `@@NOW ${now / 1000}`,
    '@@PROC 4100 1 pts/3 codex',
    '@@CWD 4100 /srv/api',
    '@@PS',
    '@@AGE 4100 10:00'
  ]
  const whole = [
    ...processes,
    `@@PIN 4100 open codex ${path}`,
    `@@FILE codex ${Buffer.byteLength(text)} ${Date.parse(at) / 1000} ${path}`,
    `@@HEAD ${path} ${b64}`,
    `@@TAIL ${path} ${b64}`,
    '@@DONE'
  ]
  // A second Codex started since; its rollout is in the part of the output that was lost.
  const cutShort = [...processes, '@@PROC 4200 1 pts/4 codex', '@@CWD 4200 /srv/web']
  let output = whole
  const host: LiveSessionHost = {
    machine: { hostId: 'ssh-1', label: 'build-box', kind: 'remote' },
    run: async () => output.join('\n')
  }
  const scanner = new HostSessionScanner(host, LOCAL_SCAN_LIMITS)
  const listed = async () =>
    (await scanner.scan(now)).sessions.map((s) => [s.providerSessionId, s.pid, s.status])
  expect(await listed()).toEqual([[CODEX_ID, 4100, 'working']])
  output = cutShort
  expect(await listed()).toEqual([[CODEX_ID, 4100, 'working']])
})

// A long tool result can fill the bytes a scan reads, leaving no response in them.
it("lists how full a session's context is, and keeps that reading while the tail holds no response", async () => {
  const path = `/home/dev/.codex/sessions/2026/11/13/rollout-2026-11-13T10-00-00-${CODEX_ID}.jsonl`
  const at = '2026-11-13T10:00:00.000Z'
  const text =
    line({ type: 'session_meta', timestamp: at, payload: { id: CODEX_ID, cwd: '/srv/api' } }) +
    line({ type: 'turn_context', timestamp: at, payload: { model: 'gpt-5.2-codex' } }) +
    line({
      type: 'event_msg',
      timestamp: at,
      payload: {
        type: 'token_count',
        info: { last_token_usage: { total_tokens: 54_400 }, model_context_window: 272_000 }
      }
    })
  const later = `ut off"}\n${line({
    type: 'response_item',
    timestamp: '2026-11-13T10:00:05.000Z',
    payload: { type: 'function_call_output', call_id: 'call_1', output: 'x'.repeat(200) }
  })}`
  const now = Date.parse(at) + 20_000
  const scanOf = (size: number, tail: string, head: string | null) => [
    `@@NOW ${now / 1000}`,
    '@@PROC 4100 1 pts/3 codex',
    '@@CWD 4100 /srv/api',
    '@@PS',
    `@@PIN 4100 open codex ${path}`,
    `@@FILE codex ${size} ${Date.parse(at) / 1000} ${path}`,
    ...(head === null ? [] : [`@@HEAD ${path} ${Buffer.from(head).toString('base64')}`]),
    `@@TAIL ${path} ${Buffer.from(tail).toString('base64')}`,
    '@@DONE'
  ]
  let output = scanOf(Buffer.byteLength(text), text, text)
  const host: LiveSessionHost = {
    machine: { hostId: 'ssh-1', label: 'build-box', kind: 'remote' },
    run: async () => output.join('\n')
  }
  const scanner = new HostSessionScanner(host, LOCAL_SCAN_LIMITS)
  const listed = async () =>
    (await scanner.scan(now)).sessions.map((s) => ({ context: s.context, model: s.model }))
  const reading = {
    context: {
      usedTokens: 54_400,
      windowTokens: 272_000,
      percentage: 20,
      estimated: false,
      rows: [],
      model: 'gpt-5.2-codex',
      compactions: 0,
      updatedAt: Date.parse(at)
    },
    model: 'gpt-5.2-codex'
  }
  expect(await listed()).toEqual([reading])

  output = scanOf(LOCAL_SCAN_LIMITS.tailBytes + 1000, later, null)
  expect(await listed()).toEqual([reading])

  // The next response is in the tail; the `turn_context` that named its model no longer is.
  const response = `ut off"}\n${line({
    type: 'event_msg',
    timestamp: '2026-11-13T10:00:09.000Z',
    payload: {
      type: 'token_count',
      info: { last_token_usage: { total_tokens: 136_000 }, model_context_window: 272_000 }
    }
  })}`
  output = scanOf(LOCAL_SCAN_LIMITS.tailBytes + 2000, response, null)
  expect(await listed()).toEqual([
    {
      context: {
        usedTokens: 136_000,
        windowTokens: 272_000,
        percentage: 50,
        estimated: false,
        rows: [],
        model: 'gpt-5.2-codex',
        updatedAt: Date.parse('2026-11-13T10:00:09.000Z')
      },
      model: 'gpt-5.2-codex'
    }
  ])
})

// Claude names no window: one is told from a response that exceeds the default.
it('keeps the model and the window it was seen to exceed across a compaction read on its own', async () => {
  const path = `/home/dev/.claude/projects/-srv-api/${CLAUDE_ID}.jsonl`
  const at = '2026-11-13T10:00:00.000Z'
  const response = (inputTokens: number, timestamp: string) =>
    line({
      type: 'assistant',
      timestamp,
      message: { model: 'claude-opus-4-5', usage: { input_tokens: inputTokens } }
    })
  const text =
    line({ type: 'user', timestamp: at, cwd: '/srv/api', message: { content: 'Refactor it' } }) +
    response(250_000, at)
  const now = Date.parse(at) + 20_000
  let output: string[] = []
  const scanOf = (size: number, tail: string, head: string | null) => {
    output = [
      `@@NOW ${now / 1000}`,
      '@@PROC 4100 1 pts/3 claude',
      '@@CWD 4100 /srv/api',
      '@@PS',
      `@@PIN 4100 open claude ${path}`,
      `@@FILE claude ${size} ${Date.parse(at) / 1000} ${path}`,
      ...(head === null ? [] : [`@@HEAD ${path} ${Buffer.from(head).toString('base64')}`]),
      `@@TAIL ${path} ${Buffer.from(tail).toString('base64')}`,
      '@@DONE'
    ]
  }
  const host: LiveSessionHost = {
    machine: { hostId: 'ssh-1', label: 'build-box', kind: 'remote' },
    run: async () => output.join('\n')
  }
  const scanner = new HostSessionScanner(host, LOCAL_SCAN_LIMITS)
  const context = async () => (await scanner.scan(now)).sessions[0].context

  scanOf(Buffer.byteLength(text), text, text)
  expect(await context()).toMatchObject({ usedTokens: 250_000, windowTokens: 1_000_000 })

  const compacted = line({ type: 'user', isCompactSummary: true, timestamp: at })
  scanOf(LOCAL_SCAN_LIMITS.tailBytes + 1000, `ut off"}\n${compacted}`, null)
  expect(await context()).toMatchObject({ windowTokens: 0, model: 'claude-opus-4-5' })

  scanOf(LOCAL_SCAN_LIMITS.tailBytes + 2000, `ut off"}\n${response(20_000, at)}`, null)
  expect(await context()).toMatchObject({
    usedTokens: 20_000,
    windowTokens: 1_000_000,
    percentage: 2
  })
})

// Nothing names a Codex's rollout as its own before its first prompt: only its folder does.
it('keeps a rollout apart from a Codex started in its folder after its own Codex exited', async () => {
  const path = `/home/dev/.codex/sessions/2026/11/13/rollout-2026-11-13T10-00-00-${CODEX_ID}.jsonl`
  const at = Date.parse('2026-11-13T10:00:00.000Z')
  const timestamp = new Date(at).toISOString()
  const text =
    line({ type: 'session_meta', timestamp, payload: { id: CODEX_ID, cwd: '/srv/api' } }) +
    line({ type: 'event_msg', timestamp, payload: { type: 'task_complete' } })
  const scanOf = (input: {
    now: number
    pid: number
    ran: string
    text: string
    written: number
  }) =>
    [
      `@@NOW ${input.now / 1000}`,
      `@@PROC ${input.pid} 1 pts/3 codex`,
      `@@CWD ${input.pid} /srv/api`,
      '@@PS',
      `@@AGE ${input.pid} ${input.ran}`,
      `@@FILE codex ${Buffer.byteLength(input.text)} ${input.written / 1000} ${path}`,
      `@@HEAD ${path} ${Buffer.from(input.text).toString('base64')}`,
      `@@TAIL ${path} ${Buffer.from(input.text).toString('base64')}`,
      '@@DONE'
    ].join('\n')
  let output = ''
  const host: LiveSessionHost = {
    machine: { hostId: 'ssh-1', label: 'build-box', kind: 'remote' },
    run: async () => output
  }
  const scanner = new HostSessionScanner(host, LOCAL_SCAN_LIMITS)
  const listed = async (now: number) =>
    (await scanner.scan(now)).sessions.map((s) => [
      s.providerSessionId,
      s.pid,
      s.inputRoutes.map((route) => route.kind).join(' ')
    ])

  output = scanOf({ now: at + 20_000, pid: 4100, ran: '10:00', text, written: at })
  expect(await listed(at + 20_000)).toEqual([[CODEX_ID, 4100, '']])

  // The first Codex exited; another started 30 seconds after the rollout's last write.
  output = scanOf({ now: at + 60_000, pid: 4200, ran: '00:30', text, written: at })
  const apart = [
    ['pid-4200', 4200, ''],
    [CODEX_ID, null, 'resume']
  ]
  expect(await listed(at + 60_000)).toEqual(apart)

  // Seal's resume, or anyone's, wrote to the rollout since: it is still not the second Codex's.
  const more = text + line({ type: 'event_msg', timestamp, payload: { type: 'task_started' } })
  output = scanOf({ now: at + 90_000, pid: 4200, ran: '01:00', text: more, written: at + 80_000 })
  expect(await listed(at + 90_000)).toEqual(apart)
})

// Seal restarted after one of two agents in a folder left: no scan saw them both, so the one
// still there is the only agent the rollout could be, and need not be the one that wrote it.
it('types nothing into the agent it finds beside a rollout after a restart until the agent holds that rollout open', async () => {
  const path = `/home/dev/.codex/sessions/2026/11/13/rollout-2026-11-13T10-00-00-${CODEX_ID}.jsonl`
  const at = Date.parse('2026-11-13T10:00:00.000Z')
  const timestamp = new Date(at).toISOString()
  const text =
    line({ type: 'session_meta', timestamp, payload: { id: CODEX_ID, cwd: '/srv/api' } }) +
    line({ type: 'event_msg', timestamp, payload: { type: 'task_complete' } })
  const b64 = Buffer.from(text).toString('base64')
  const scanOf = (pins: string[]) =>
    [
      `@@NOW ${(at + 20_000) / 1000}`,
      '@@PROC 4200 900 pts/3 codex',
      '@@CWD 4200 /srv/api',
      '@@TMUX /tmp/tmux-1000/default\t%4\t/dev/pts/3\t900\tmain:0.0',
      '@@PS',
      '@@AGE 4200 10:00',
      ...pins,
      `@@FILE codex ${Buffer.byteLength(text)} ${at / 1000} ${path}`,
      `@@HEAD ${path} ${b64}`,
      `@@TAIL ${path} ${b64}`,
      '@@DONE'
    ].join('\n')
  const listed = async (pins: string[]) => {
    const host: LiveSessionHost = {
      machine: { hostId: 'ssh-1', label: 'build-box', kind: 'remote' },
      run: async () => scanOf(pins)
    }
    const afterRestart = new HostSessionScanner(host, LOCAL_SCAN_LIMITS)
    return (await afterRestart.scan(at + 20_000)).sessions.map((s) => [
      s.providerSessionId,
      s.pid,
      s.inputRoutes.map((route) => route.kind).join(' ')
    ])
  }
  expect(await listed([])).toEqual([[CODEX_ID, 4200, '']])
  expect(await listed([`@@PIN 4200 open codex ${path}`])).toEqual([
    [CODEX_ID, 4200, 'codex-queue tmux']
  ])
})

// Two terminals open in one repository, neither prompted yet; nothing ties either to a rollout.
it('pairs neither of two agents idle in one folder with the rollout one of them begins, even once that one has left', async () => {
  const path = `/home/dev/.codex/sessions/2026/11/13/rollout-2026-11-13T10-00-00-${CODEX_ID}.jsonl`
  const at = Date.parse('2026-11-13T10:00:00.000Z')
  const timestamp = new Date(at).toISOString()
  const text =
    line({ type: 'session_meta', timestamp, payload: { id: CODEX_ID, cwd: '/srv/api' } }) +
    line({ type: 'event_msg', timestamp, payload: { type: 'task_complete' } })
  const b64 = Buffer.from(text).toString('base64')
  const scanOf = (pids: number[]) =>
    [
      `@@NOW ${(at + 20_000) / 1000}`,
      ...pids.flatMap((pid) => [`@@PROC ${pid} 1 pts/${pid} codex`, `@@CWD ${pid} /srv/api`]),
      '@@PS',
      ...pids.map((pid) => `@@AGE ${pid} 10:00`),
      `@@FILE codex ${Buffer.byteLength(text)} ${at / 1000} ${path}`,
      `@@HEAD ${path} ${b64}`,
      `@@TAIL ${path} ${b64}`,
      '@@DONE'
    ].join('\n')
  let output = scanOf([4100, 4200])
  const host: LiveSessionHost = {
    machine: { hostId: 'ssh-1', label: 'build-box', kind: 'remote' },
    run: async () => output
  }
  const scanner = new HostSessionScanner(host, LOCAL_SCAN_LIMITS)
  const listed = async () =>
    (await scanner.scan(at + 20_000)).sessions.map((s) => [
      s.providerSessionId,
      s.pid,
      s.inputRoutes.map((route) => route.kind).join(' ')
    ])
  expect(await listed()).toEqual([
    ['pid-4100', 4100, ''],
    ['pid-4200', 4200, ''],
    [CODEX_ID, null, '']
  ])

  output = scanOf([4200])
  const apart = [
    ['pid-4200', 4200, ''],
    [CODEX_ID, null, '']
  ]
  expect(await listed()).toEqual(apart)

  // Newer rollouts pushed it off the host's list for a scan: it is read anew when it returns.
  const whole = output
  output = whole
    .split('\n')
    .filter((row) => !row.includes(path))
    .join('\n')
  expect(await listed()).toEqual([['pid-4200', 4200, '']])
  output = whole
  expect(await listed()).toEqual(apart)
})

const viaAiVault = () =>
  aiVaultTranscriptFiles(async () => ({
    claudeProjectsDir: join(home, '.claude/projects'),
    codexSessionsDir: join(home, '.codex/sessions')
  }))

// Runs the real discovery script through /bin/sh; transcripts come from its `find` (SSH) or AI Vault (this machine).
describe.skipIf(process.platform === 'win32')('HostSessionScanner on a real shell', () => {
  it.each([
    ['the script', () => undefined],
    ['AI Vault discovery', viaAiVault]
  ])(
    'finds Claude and Codex transcripts through %s, then follows one as it grows',
    async (_, source) => {
      const claudeFile = join(home, '.claude/projects/-srv-app', `${CLAUDE_ID}.jsonl`)
      await mkdir(join(home, '.claude/projects/-srv-app'), { recursive: true })
      const now = '2026-11-13T10:00:00.000Z'
      await writeFile(
        claudeFile,
        line({
          type: 'user',
          cwd: '/srv/app',
          timestamp: now,
          message: { role: 'user', content: 'Fix the login bug' }
        }) +
          line({
            type: 'assistant',
            timestamp: now,
            message: {
              role: 'assistant',
              stop_reason: 'end_turn',
              content: [{ type: 'text', text: 'Done.' }]
            }
          })
      )
      const codexDir = join(home, '.codex/sessions/2026/11/13')
      await mkdir(codexDir, { recursive: true })
      await writeFile(
        join(codexDir, `rollout-2026-11-13T10-00-00-${CODEX_ID}.jsonl`),
        line({ type: 'session_meta', timestamp: now, payload: { id: CODEX_ID, cwd: '/srv/api' } }) +
          line({
            type: 'event_msg',
            timestamp: now,
            payload: { type: 'user_message', message: 'Add rate limiting' }
          }) +
          line({ type: 'event_msg', timestamp: now, payload: { type: 'task_started' } })
      )

      const scanner = new HostSessionScanner(localHost('test', source()), LOCAL_SCAN_LIMITS)
      const first = await scanner.scan((await stat(claudeFile)).mtimeMs)
      expect(first.complete).toBe(true)
      const ours = (sessions: typeof first.sessions) =>
        Object.fromEntries(
          sessions
            .filter((s) => s.transcriptPath?.startsWith(home))
            .map((s) => [s.id, { project: s.project, title: s.title, status: s.status }])
        )
      expect(ours(first.sessions)).toEqual({
        [`local:claude:${CLAUDE_ID}`]: {
          project: 'app',
          title: 'Fix the login bug',
          status: 'your-turn'
        },
        [`local:codex:${CODEX_ID}`]: {
          project: 'api',
          title: 'Add rate limiting',
          status: 'working'
        }
      })

      await appendFile(
        claudeFile,
        line({
          type: 'user',
          timestamp: '2026-11-13T10:01:00.000Z',
          message: { role: 'user', content: 'Now add a test' }
        })
      )
      const second = await scanner.scan((await stat(claudeFile)).mtimeMs)
      expect(ours(second.sessions)[`local:claude:${CLAUDE_ID}`]).toEqual({
        project: 'app',
        title: 'Fix the login bug',
        status: 'working'
      })
    }
  )

  it.each([
    ['the script', () => undefined],
    ['AI Vault discovery', viaAiVault]
  ])(
    "reads a session's subagent transcripts through %s and follows one as it finishes",
    async (_, source) => {
      const dir = join(home, '.claude/projects/-srv-app')
      const subagents = join(dir, CLAUDE_ID, 'subagents')
      await mkdir(subagents, { recursive: true })
      const at = '2026-11-13T10:00:00.000Z'
      const launch = {
        type: 'tool_use',
        id: 'toolu_01launch',
        name: 'Agent',
        input: {
          description: 'Map the routes',
          prompt: 'List every route.',
          run_in_background: true
        }
      }
      await writeFile(
        join(dir, `${CLAUDE_ID}.jsonl`),
        line({
          type: 'user',
          cwd: '/srv/app',
          timestamp: at,
          message: { content: 'Map the app' }
        }) +
          line({ type: 'assistant', timestamp: at, message: { content: [launch] } }) +
          line({
            type: 'user',
            timestamp: at,
            toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'a1b2c3' },
            message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_01launch' }] }
          }) +
          line({
            type: 'assistant',
            timestamp: at,
            message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Started.' }] }
          })
      )
      const subagentFile = join(subagents, 'agent-a1b2c3.jsonl')
      const reading = {
        type: 'tool_use',
        id: 'toolu_01read',
        name: 'Read',
        input: { file_path: '/srv/app/routes.ts' }
      }
      await writeFile(
        subagentFile,
        line({
          type: 'user',
          isSidechain: true,
          timestamp: at,
          message: { content: 'List every route.' }
        }) +
          line({
            type: 'assistant',
            isSidechain: true,
            timestamp: at,
            message: { content: [reading] }
          })
      )
      await writeFile(
        join(subagents, 'agent-a1b2c3.meta.json'),
        JSON.stringify({
          description: 'Map the routes',
          toolUseId: 'toolu_01launch',
          requestShape: 'background'
        })
      )

      const scanner = new HostSessionScanner(localHost('test', source()), LOCAL_SCAN_LIMITS)
      const ours = async () => {
        const result = await scanner.scan((await stat(subagentFile)).mtimeMs)
        const session = result.sessions.find((s) => s.transcriptPath?.startsWith(home))
        return [
          session?.status,
          session?.activity?.subagents.map((s) => [s.id, s.title, s.status, s.activity])
        ]
      }
      expect(await ours()).toEqual([
        'waiting-subagent',
        [['a1b2c3', 'Map the routes', 'running', 'Read: routes.ts']]
      ])

      await appendFile(
        subagentFile,
        line({
          type: 'assistant',
          isSidechain: true,
          timestamp: '2026-11-13T10:02:00.000Z',
          message: { content: [{ type: 'text', text: 'There are 12 routes.' }] }
        }) +
          line({
            type: 'attachment',
            isSidechain: true,
            timestamp: '2026-11-13T10:02:00.000Z',
            attachment: { type: 'hook_success', hookEvent: 'SubagentStop' }
          })
      )
      expect(await ours()).toEqual([
        'your-turn',
        [['a1b2c3', 'Map the routes', 'completed', 'There are 12 routes.']]
      ])
    }
  )

  // A stand-in agent (a process named `claude`) with a real child process, read by the real `ps`.
  it('tells a command running under an agent process from a call that waits for approval', async () => {
    const root = await realpath(home)
    const cwd = join(root, 'work')
    const projects = join(root, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
    const snapshots = join(root, '.claude/shell-snapshots')
    await Promise.all([cwd, projects, snapshots].map((dir) => mkdir(dir, { recursive: true })))
    // Claude Code's Bash tool runs `bash -c 'source ~/.claude/shell-snapshots/… && eval <command>'`.
    await writeFile(join(snapshots, 'run.sh'), 'sleep 60\n')
    await writeFile(
      join(root, 'agent.sh'),
      `bash "${join(snapshots, 'run.sh')}" &\necho $! > "${join(root, 'child.pid')}"\nwait\nsleep 60\n`
    )
    // ast-grep-ignore: test-no-wall-clock -- the call is aged against real processes, whose start times `ps` reports on the real clock
    const called = new Date(Date.now() - 10_000).toISOString()
    await writeFile(
      join(projects, `${CLAUDE_ID}.jsonl`),
      line({ type: 'permission-mode', permissionMode: 'default' }) +
        line({ type: 'user', cwd, timestamp: called, message: { content: 'Run the migration' } }) +
        line({
          type: 'assistant',
          timestamp: called,
          message: {
            role: 'assistant',
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_01run',
                name: 'Bash',
                input: { command: './migrate.sh' }
              }
            ]
          }
        })
    )
    const agent = spawn(
      'bash',
      ['-c', 'exec -a claude bash "$1"', 'agent', join(root, 'agent.sh')],
      {
        cwd,
        stdio: 'ignore'
      }
    )
    try {
      // Claude names its session in its registry: the transcript began before this stand-in did.
      await mkdir(join(root, '.claude/sessions'), { recursive: true })
      await writeFile(
        join(root, `.claude/sessions/${agent.pid}.json`),
        JSON.stringify({ pid: agent.pid, sessionId: CLAUDE_ID })
      )
      const childPid = await vi.waitFor(async () =>
        Number((await readFile(join(root, 'child.pid'), 'utf8')).trim())
      )
      const scanner = new HostSessionScanner(localHost('test'), LOCAL_SCAN_LIMITS)
      const ours = async () => {
        // ast-grep-ignore: test-no-wall-clock -- the scan reads real processes on the real clock
        const { sessions } = await scanner.scan(Date.now())
        const session = sessions.find((s) => s.transcriptPath?.startsWith(root))
        return [session?.pid, session?.status, session?.statusSource]
      }
      expect(await ours()).toEqual([agent.pid, 'running-shell', 'process'])

      process.kill(childPid)
      await vi.waitFor(async () =>
        expect(await ours()).toEqual([agent.pid, 'needs-permission', 'process'])
      )
    } finally {
      agent.kill('SIGKILL')
    }
  })

  // The real `ps` says when the stand-in agent started: ten minutes after the transcript's last write.
  it('lists an agent apart from a transcript in its folder that was last written before it started', async () => {
    const root = await realpath(home)
    const cwd = join(root, 'work')
    const projects = join(root, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
    await Promise.all([cwd, projects].map((dir) => mkdir(dir, { recursive: true })))
    const file = join(projects, `${CLAUDE_ID}.jsonl`)
    // ast-grep-ignore: test-no-wall-clock -- the transcript is aged against a real process, whose start time `ps` reports on the real clock
    const written = Date.now() - 600_000
    await writeFile(
      file,
      line({
        type: 'user',
        cwd,
        timestamp: new Date(written).toISOString(),
        message: { content: 'Fix the login bug' }
      })
    )
    await utimes(file, written / 1000, written / 1000)
    await writeFile(join(root, 'agent.sh'), 'sleep 60\n')
    const agent = spawn(
      'bash',
      ['-c', 'exec -a claude bash "$1"', 'agent', join(root, 'agent.sh')],
      { cwd, stdio: 'ignore' }
    )
    try {
      const scanner = new HostSessionScanner(localHost('test'), LOCAL_SCAN_LIMITS)
      await vi.waitFor(async () => {
        // ast-grep-ignore: test-no-wall-clock -- the scan reads real processes on the real clock
        const { sessions } = await scanner.scan(Date.now())
        expect(
          sessions
            .filter((s) => s.pid === agent.pid || s.transcriptPath === file)
            .map((s) => [s.providerSessionId, s.pid, s.alive])
            .sort()
        ).toEqual([
          [CLAUDE_ID, null, false],
          [`pid-${agent.pid}`, agent.pid, true]
        ])
      })
    } finally {
      agent.kill('SIGKILL')
    }
  })

  // No agent runs for this session, and the real `ps` says so.
  it('ends a session whose approval hook outlived its agent', async () => {
    const root = await realpath(home)
    const projects = join(root, '.claude/projects/-srv-app')
    const hooks = join(root, '.config/sisomewhere/agents')
    await Promise.all([projects, hooks].map((dir) => mkdir(dir, { recursive: true })))
    // ast-grep-ignore: test-no-wall-clock -- the scan ages the transcript's real mtime on the real clock
    const leftAt = Date.now() - 600_000
    const file = join(projects, `${CLAUDE_ID}.jsonl`)
    await writeFile(
      file,
      line({
        type: 'user',
        cwd: '/srv/app',
        timestamp: new Date(leftAt).toISOString(),
        message: { content: 'Run the migration' }
      }) +
        line({
          type: 'assistant',
          timestamp: new Date(leftAt).toISOString(),
          message: {
            role: 'assistant',
            stop_reason: 'tool_use',
            content: [
              { type: 'tool_use', id: 'toolu_01run', name: 'Bash', input: { command: './go.sh' } }
            ]
          }
        })
    )
    await utimes(file, leftAt / 1000, leftAt / 1000)
    await writeFile(
      join(hooks, `${CLAUDE_ID}.json`),
      JSON.stringify({ id: CLAUDE_ID, state: 'needs', updated: Math.floor(leftAt / 1000) })
    )
    const scanner = new HostSessionScanner(localHost('test'), LOCAL_SCAN_LIMITS)
    // ast-grep-ignore: test-no-wall-clock -- the scan reads real processes on the real clock
    const { sessions } = await scanner.scan(Date.now())
    expect(sessions.find((s) => s.transcriptPath === file)?.status).toBe('done')
  })
})
