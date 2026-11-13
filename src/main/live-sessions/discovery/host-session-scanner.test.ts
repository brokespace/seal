import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localHost } from '../hosts/live-session-hosts'
import { HostSessionScanner, LOCAL_SCAN_LIMITS } from './host-session-scanner'

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

// Runs the real discovery script through /bin/sh, as a scan of this machine does.
describe.skipIf(process.platform === 'win32')('HostSessionScanner on a real shell', () => {
  it('finds Claude and Codex transcripts, then follows one as it grows', async () => {
    const claudeFile = join(home, '.claude/projects/-srv-app', `${CLAUDE_ID}.jsonl`)
    await mkdir(join(home, '.claude/projects/-srv-app'), { recursive: true })
    const now = new Date().toISOString()
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
          message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }
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

    const scanner = new HostSessionScanner(localHost('test'), LOCAL_SCAN_LIMITS, () => ({
      claudeProjectsDirs: [],
      codexSessionsDirs: []
    }))
    const first = await scanner.scan(Date.now())
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
        status: 'waiting-input'
      },
      [`local:codex:${CODEX_ID}`]: { project: 'api', title: 'Add rate limiting', status: 'working' }
    })

    await appendFile(
      claudeFile,
      line({
        type: 'user',
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: 'Now add a test' }
      })
    )
    const second = await scanner.scan(Date.now())
    expect(ours(second.sessions)[`local:claude:${CLAUDE_ID}`]).toEqual({
      project: 'app',
      title: 'Fix the login bug',
      status: 'working'
    })
  })
})
