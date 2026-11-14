import { appendFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localHost } from '../hosts/live-session-hosts'
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
          status: 'idle'
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
        'idle',
        [['a1b2c3', 'Map the routes', 'completed', 'There are 12 routes.']]
      ])
    }
  )
})
