import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostAccountSignInChannel } from '../../../shared/host-account-sign-in-types'
import { liveAccountCliProcessCount } from '../../provider-process/account-cli-process-reaper'
import { claudeStateFile, readClaudeFolderLogin } from './claude-account-folder'
import { runClaudeCommandProcess } from './claude-command-process'
import { runClaudePastedCodeLogin } from './claude-pasted-code-login'

const SIGN_IN_LINK =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=test&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=STATE'

// Stands in for `claude auth login --claudeai`: prints the pasted-code link, waits for the code on
// stdin, and writes the login into CLAUDE_CONFIG_DIR. A helper child ignores SIGTERM like the CLI's
// own worker can, so a cancelled login only ends when its whole group is killed.
const FAKE_CLAUDE = String.raw`#!/usr/bin/env node
const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
process.on('SIGTERM', () => {})
const helper = spawn(
  process.execPath,
  ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('armed'); setInterval(() => {}, 60000)"],
  { stdio: ['ignore', 'pipe', 'ignore'] }
)
helper.stdout.once('data', () => {
  writeFileSync(process.env.FAKE_CLAUDE_PIDS, JSON.stringify({ cli: process.pid, helper: helper.pid }))
  process.stdout.write("Opening browser to sign in\nIf the browser didn't open, visit: ${SIGN_IN_LINK}\nPaste code here if prompted > ")
})
process.stdin.once('data', (chunk) => {
  if (chunk.toString().trim() !== 'good-code#STATE') {
    process.stderr.write('Invalid code\n')
    helper.kill('SIGKILL')
    process.exit(1)
  }
  const dir = process.env.CLAUDE_CONFIG_DIR
  writeFileSync(join(dir, '.claude.json'), JSON.stringify({
    oauthAccount: { emailAddress: 'brian@x.io', organizationUuid: 'org-1', organizationName: 'Acme' }
  }))
  writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'at' } }))
  helper.kill('SIGKILL')
  process.exit(0)
})
`

const posixOnly = process.platform === 'win32' ? describe.skip : describe
let root: string
let configDir: string
let pidFile: string
let savedPath: string | undefined
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

async function gone(): Promise<boolean> {
  const pids = readPids()
  if (!pids) {
    return false
  }
  await expect.poll(() => alive(pids.cli) || alive(pids.helper), { timeout: 10_000 }).toBe(false)
  return true
}

function channel(code: Promise<string>) {
  const controller = new AbortController()
  const prompted = Promise.withResolvers<{ url: string; needsCode: boolean }>()
  const value: HostAccountSignInChannel = {
    signal: controller.signal,
    onPrompt: (prompt) => prompted.resolve({ url: prompt.url, needsCode: prompt.needsCode }),
    nextCode: () => code
  }
  return { value, controller, prompted: prompted.promise }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'claude-login-process-'))
  configDir = join(root, 'account')
  pidFile = join(root, 'pids.json')
  const bin = join(root, 'bin')
  mkdirSync(configDir)
  mkdirSync(bin)
  writeFileSync(join(bin, 'claude'), FAKE_CLAUDE)
  chmodSync(join(bin, 'claude'), 0o755)
  savedPath = process.env.PATH
  vi.stubEnv('PATH', `${bin}${delimiter}${savedPath ?? ''}`)
  vi.stubEnv('FAKE_CLAUDE_PIDS', pidFile)
})

afterEach(() => {
  vi.unstubAllEnvs()
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

posixOnly('Claude sign-in against a real CLI process', () => {
  const folder = () => ({ windowsPath: configDir, linuxPath: null, wslDistro: null })

  it('signs in inside the account folder from a pasted code and leaves no process behind', async () => {
    const code = Promise.withResolvers<string>()
    const { value, prompted } = channel(code.promise)

    const login = runClaudePastedCodeLogin(folder(), runClaudeCommandProcess, value, () => {})
    expect(await prompted).toEqual({ url: SIGN_IN_LINK, needsCode: true })
    code.resolve('good-code#STATE')
    await login

    expect(readClaudeFolderLogin(claudeStateFile(configDir))).toEqual({
      email: 'brian@x.io',
      organizationUuid: 'org-1',
      organizationName: 'Acme'
    })
    expect(await gone()).toBe(true)
    expect(liveAccountCliProcessCount()).toBe(0)
  })

  it('reports a rejected code and leaves no process behind', async () => {
    const { value } = channel(Promise.resolve('wrong-code'))

    await expect(
      runClaudePastedCodeLogin(folder(), runClaudeCommandProcess, value, () => {})
    ).rejects.toThrow('Claude did not accept that code. Start the sign-in again.')

    expect(readClaudeFolderLogin(claudeStateFile(configDir))).toBeNull()
    expect(await gone()).toBe(true)
  })

  it('kills the CLI and its helper when the sign-in is cancelled', async () => {
    const { value, controller, prompted } = channel(new Promise<string>(() => {}))

    const login = runClaudePastedCodeLogin(folder(), runClaudeCommandProcess, value, () => {})
    await prompted
    controller.abort()

    await expect(login).rejects.toThrow('Claude sign-in was cancelled.')
    expect(await gone()).toBe(true)
    expect(liveAccountCliProcessCount()).toBe(0)
  })

  it('kills the CLI and its helper when the sign-in times out', async () => {
    await expect(
      runClaudeCommandProcess(['auth', 'login', '--claudeai'], folder(), 1_500, {
        keepStdinOpen: true
      })
    ).rejects.toThrow('Claude sign-in took too long to finish.')

    expect(await gone()).toBe(true)
    expect(liveAccountCliProcessCount()).toBe(0)
  })
})
