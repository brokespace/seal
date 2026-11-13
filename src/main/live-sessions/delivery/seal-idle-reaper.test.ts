import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localHost } from '../hosts/live-session-hosts'
import { idleReapMinutes, SealIdleReaper, sealIdleReapScript } from './seal-idle-reaper'

let dir: string

const tmux = (...args: string[]) =>
  runProcess({ program: 'tmux', args, env: { ...process.env, TMUX_TMPDIR: dir } })

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'seal-reap-')))
  vi.stubEnv('TMUX_TMPDIR', dir)
})

afterEach(async () => {
  await tmux('-L', 'seal', 'kill-server').catch(() => undefined)
  await tmux('-L', 'default', 'kill-server').catch(() => undefined)
  vi.unstubAllEnvs()
  await rm(dir, { recursive: true, force: true })
})

async function sessions(socket: string): Promise<string[]> {
  const out = await tmux('-L', socket, 'list-sessions', '-F', '#{session_name}').catch(() => null)
  return (out?.stdout ?? '').split('\n').filter(Boolean)
}

describe.skipIf(process.platform === 'win32')('the idle reaper', () => {
  it("ends Seal's unattached wrapper sessions and leaves the user's own tmux alone", async () => {
    const probe = await runProcess({ program: 'tmux', args: ['-V'] }).catch(() => null)
    if (!probe) {
      return
    }
    await tmux('-L', 'seal', 'new-session', '-d', '-s', 'claude-4242', 'sleep 600')
    await tmux('-L', 'default', 'new-session', '-d', '-s', 'mine', 'sleep 600')

    const reaped = await new SealIdleReaper({ minutes: () => 1 }).sweep(localHost('mbp'))
    expect(reaped).toEqual([])

    const out = await localHost('mbp').run(sealIdleReapScript(0))
    expect(out.trim()).toBe('@@REAPED claude-4242')
    expect(await sessions('seal')).toEqual([])
    expect(await sessions('default')).toEqual(['mine'])
  })

  it('reads the setting: default two hours, zero or less never', () => {
    expect([undefined, 30, 0, -5].map(idleReapMinutes)).toEqual([120, 30, null, null])
  })
})
