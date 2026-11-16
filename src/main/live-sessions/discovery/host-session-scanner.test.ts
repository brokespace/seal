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
    '@@PS'
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
