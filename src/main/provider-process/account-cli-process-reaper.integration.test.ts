import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAccountCliOnce } from './account-cli-one-shot'
import {
  killAllAccountCliProcesses,
  liveAccountCliProcessCount,
  reapAccountCliProcess,
  trackAccountCliProcess
} from './account-cli-process-reaper'

// A CLI wrapper with a helper child, as `claude` and `codex` run their real work in one. Neither
// stops on SIGTERM, so only a group SIGKILL ends them.
const STUBBORN_CLI = String.raw`
  const { spawn } = require('node:child_process')
  const { writeFileSync } = require('node:fs')
  process.on('SIGTERM', () => {})
  const helper = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('armed'); setInterval(() => {}, 60000)"],
    { stdio: ['ignore', 'pipe', 'ignore'] }
  )
  helper.stdout.once('data', () => {
    writeFileSync(process.env.PID_FILE, JSON.stringify({ cli: process.pid, helper: helper.pid }))
  })
  setInterval(() => {}, 60000)
`

const posixOnly = process.platform === 'win32' ? describe.skip : describe
let root: string
let pidFile: string
const recorded = new Set<number>()

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

function readPids(): { cli: number; helper: number } | null {
  try {
    const pids: { cli: number; helper: number } = JSON.parse(readFileSync(pidFile, 'utf8'))
    recorded.add(pids.cli).add(pids.helper)
    return pids
  } catch {
    return null
  }
}

function startedPids(): Promise<{ cli: number; helper: number }> {
  return vi.waitFor(
    () => {
      const pids = readPids()
      if (!pids) {
        throw new Error('the stub CLI has not reported its pids yet')
      }
      return pids
    },
    { timeout: 15_000 }
  )
}

function expectGone(pids: { cli: number; helper: number }): Promise<void> {
  return expect.poll(() => alive(pids.cli) || alive(pids.helper), { timeout: 10_000 }).toBe(false)
}

function spawnStubbornCli() {
  const child = spawn(process.execPath, ['-e', STUBBORN_CLI], {
    env: { ...process.env, PID_FILE: pidFile },
    stdio: 'ignore',
    detached: true
  })
  trackAccountCliProcess(child, { group: true })
  return child
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'account-cli-reaper-'))
  pidFile = join(root, 'pids.json')
})

afterEach(() => {
  for (const pid of recorded) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone, which is what every test here expects.
    }
  }
  recorded.clear()
  rmSync(root, { recursive: true, force: true })
})

posixOnly('account CLI processes', () => {
  it('force-kills a cancelled login and its helper when both ignore SIGTERM', async () => {
    const child = spawnStubbornCli()
    const pids = await startedPids()
    expect(liveAccountCliProcessCount()).toBe(1)

    reapAccountCliProcess(child, { group: true, graceMs: 200 })

    await expectGone(pids)
    expect(liveAccountCliProcessCount()).toBe(0)
  })

  it('kills a one-shot command that outlives its timeout, helper included', async () => {
    const run = runAccountCliOnce({
      command: process.execPath,
      args: ['-e', STUBBORN_CLI],
      env: { ...process.env, PID_FILE: pidFile },
      timeoutMs: 1_500
    })
    const pids = await startedPids()

    const result = await run

    expect(result.timedOut).toBe(true)
    expect(result.code).toBeNull()
    await expectGone(pids)
    expect(liveAccountCliProcessCount()).toBe(0)
  })

  it('kills every running account CLI when the app exits mid sign-in', async () => {
    spawnStubbornCli()
    const pids = await startedPids()

    killAllAccountCliProcesses()

    await expectGone(pids)
  })
})
