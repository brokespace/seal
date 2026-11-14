import { mkdir, mkdtemp, open, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import type { ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnProcess } from '@orca/process-host'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveSessionHostRunParams } from '../../../shared/live-sessions/live-session-rpc-params'
import { HostSessionScanner, RUNTIME_SCAN_LIMITS } from '../discovery/host-session-scanner'
import { LiveSessionRegistry } from '../live-session-registry'
import { runLiveSessionHostScript } from './live-session-host-run'
import {
  LIVE_SESSION_HOST_RUN_METHOD,
  runtimeLiveSessionHost,
  type RuntimeEnvironmentCall
} from './runtime-live-session-host'

const CLAUDE_ID = '7d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6'
const CODEX_ID = '0199b2c3-d4e5-7f60-8a1b-2c3d4e5f6a7b'
const THREE_DAYS_AGO = new Date('2026-11-10T09:00:00Z')
const line = (record: unknown) => `${JSON.stringify(record)}\n`

let home: string
let children: ChildProcess[]

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'seal-runtime-')))
  children = []
  vi.stubEnv('HOME', home)
  vi.stubEnv('CLAUDE_CONFIG_DIR', '')
  vi.stubEnv('CODEX_HOME', '')
})

afterEach(async () => {
  for (const child of children) {
    child.kill('SIGKILL')
  }
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})

/** A paired server as the desktop reaches it: every call runs the server's own `liveSessions.hostRun`. */
const serverCall: RuntimeEnvironmentCall = async (_environmentId, method, params) =>
  method === LIVE_SESSION_HOST_RUN_METHOD
    ? {
        id: '1',
        ok: true,
        result: await runLiveSessionHostScript(LiveSessionHostRunParams.parse(params)),
        _meta: { runtimeId: 'kessel-ml' }
      }
    : {
        id: '1',
        ok: false,
        error: { code: 'method_not_found', message: `Unknown method: ${method}` }
      }

/** An agent CLI as `ps` shows it: a binary named `claude`/`codex`, alive until the test kills it. */
async function startAgent(name: string, cwd: string, openFile?: string): Promise<number> {
  await mkdir(join(home, 'bin'), { recursive: true })
  const binary = join(home, 'bin', name)
  await symlink(process.execPath, binary).catch(() => {})
  const held = openFile ? await open(openFile, 'r') : null
  const child = spawnProcess({
    program: binary,
    args: ['-e', 'process.stdin.resume()'],
    cwd,
    stdio: ['pipe', 'ignore', 'ignore', ...(held ? [held.fd] : [])]
  })
  await held?.close()
  children.push(child)
  return child.pid!
}

describe.skipIf(process.platform === 'win32')('a paired server reached through its runtime', () => {
  it('lists a running Claude whose transcript is days old, in its tmux-less folder', async () => {
    const cwd = join(home, 'work/app')
    await mkdir(cwd, { recursive: true })
    const projectDir = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
    await mkdir(projectDir, { recursive: true })
    const transcriptPath = join(projectDir, `${CLAUDE_ID}.jsonl`)
    await writeFile(
      transcriptPath,
      line({
        type: 'user',
        cwd,
        timestamp: THREE_DAYS_AGO.toISOString(),
        message: { role: 'user', content: 'Migrate the billing tables' }
      })
    )
    await utimes(transcriptPath, THREE_DAYS_AGO, THREE_DAYS_AGO)
    const pid = await startAgent('claude', cwd)

    const host = runtimeLiveSessionHost({ id: 'env-1', label: 'kessel-ml' }, serverCall)
    const { sessions, complete } = await new HostSessionScanner(host, RUNTIME_SCAN_LIMITS).scan(
      THREE_DAYS_AGO.getTime() + 3 * 86_400_000
    )

    expect(complete).toBe(true)
    const found = sessions.find((s) => s.providerSessionId === CLAUDE_ID)
    expect(found).toMatchObject({
      id: `runtime:env-1:claude:${CLAUDE_ID}`,
      machine: {
        hostId: 'runtime:env-1',
        label: 'kessel-ml',
        kind: 'remote',
        executionHostId: 'runtime:env-1',
        connection: 'server'
      },
      alive: true,
      pid,
      transcriptPath,
      title: 'Migrate the billing tables',
      status: 'working'
    })
  })

  it.skipIf(process.platform !== 'linux')(
    'follows the old rollout a running Codex holds open',
    async () => {
      const cwd = join(home, 'work/api')
      await mkdir(cwd, { recursive: true })
      const dir = join(home, '.codex/sessions/2026/11/10')
      await mkdir(dir, { recursive: true })
      const rollout = join(dir, `rollout-2026-11-10T09-00-00-${CODEX_ID}.jsonl`)
      await writeFile(
        rollout,
        line({ type: 'session_meta', payload: { id: CODEX_ID, cwd } }) +
          line({ type: 'event_msg', payload: { type: 'user_message', message: 'Add rate limits' } })
      )
      await utimes(rollout, THREE_DAYS_AGO, THREE_DAYS_AGO)
      const pid = await startAgent('codex', cwd, rollout)

      const host = runtimeLiveSessionHost({ id: 'env-1', label: 'kessel-ml' }, serverCall)
      const { sessions } = await new HostSessionScanner(host, RUNTIME_SCAN_LIMITS).scan(
        THREE_DAYS_AGO.getTime() + 3 * 86_400_000
      )

      expect(sessions.find((s) => s.providerSessionId === CODEX_ID)).toMatchObject({
        id: `runtime:env-1:codex:${CODEX_ID}`,
        alive: true,
        pid,
        transcriptPath: rollout
      })
    }
  )

  it('tells the user to update a server that predates live sessions', async () => {
    const outdated: RuntimeEnvironmentCall = async (_environmentId, method) => ({
      id: '1',
      ok: false,
      error: { code: 'method_not_found', message: `Unknown method: ${method}` }
    })
    const registry = new LiveSessionRegistry({
      localMachine: { hostId: 'local', label: 'mac', kind: 'local' },
      hosts: () => [runtimeLiveSessionHost({ id: 'env-old', label: 'kessel-ml' }, outdated)],
      sealPanes: () => [],
      now: () => 0
    })

    await registry.refresh()

    expect(registry.getSnapshot().hostErrors).toEqual({
      'runtime:env-old':
        'kessel-ml runs an older Seal: update Seal on this server to see and message its agent sessions'
    })
  })
})
