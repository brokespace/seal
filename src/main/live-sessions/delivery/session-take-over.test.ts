import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { spawnProcess } from '@orca/process-host'
import { afterEach, describe, expect, it } from 'vitest'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import { localHost } from '../hosts/live-session-hosts'
import { takeOverSession } from './session-take-over'

const session = (pid: number): LiveSession => ({
  id: 'local:claude:11111111-1111-4111-8111-111111111111',
  provider: 'claude',
  providerSessionId: '11111111-1111-4111-8111-111111111111',
  machine: { hostId: 'local', label: 'mac', kind: 'local' },
  origin: 'external',
  cwd: '/srv/app',
  project: 'app',
  title: null,
  status: 'waiting-input',
  statusSource: 'transcript',
  statusDetail: null,
  lastActivityAt: 1,
  startedAt: 1,
  alive: true,
  pid,
  transcriptPath: '/home/b/.claude/projects/x/11111111-1111-4111-8111-111111111111.jsonl',
  inputRoutes: [],
  permission: null
})

let dir: string
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const step of cleanup.splice(0)) {
    step()
  }
})

describe.skipIf(process.platform === 'win32')('takeOverSession', () => {
  it('stops the agent process and leaves a reused pid that now runs something else alone', async () => {
    dir = mkdtempSync(join(tmpdir(), 'seal-take-over-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'claude'), '#!/bin/sh\nwhile :; do sleep 1; done\n')
    chmodSync(join(dir, 'claude'), 0o755)
    const agent = spawnProcess({ program: join(dir, 'claude'), args: [] })
    const bystander = spawnProcess({ program: 'sleep', args: ['30'] })
    cleanup.push(() => bystander.kill('SIGKILL'))
    const exited = once(agent, 'exit')
    const host = localHost('mac')

    const result = await takeOverSession(session(agent.pid!), host)
    expect(result).toMatchObject({
      ok: true,
      provider: 'claude',
      providerSessionId: '11111111-1111-4111-8111-111111111111',
      cwd: '/srv/app'
    })
    expect((await exited)[1]).toBe('SIGTERM')

    expect(await takeOverSession(session(bystander.pid!), host)).toMatchObject({ ok: true })
    expect(bystander.exitCode).toBeNull()
    expect(bystander.signalCode).toBeNull()
  })

  it('refuses Seal panes and sessions it has no id to resume', async () => {
    const host = localHost('mac')
    expect(await takeOverSession({ ...session(1), origin: 'seal' }, host)).toEqual({
      ok: false,
      reason: 'not_external'
    })
    expect(await takeOverSession({ ...session(1), providerSessionId: 'pid-1' }, host)).toEqual({
      ok: false,
      reason: 'not_resumable'
    })
  })
})
