import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HomeChatAssistantRuntime } from '../home-chat-assistant-runtime'
import { createLocalMachine } from '../machines/home-chat-local-machine'
import {
  createTestHomeChatRuntime,
  testToolContext,
  type RecordedWake
} from '../testing/home-chat-runtime.test-support'
import { executeHomeChatTool } from './home-chat-tool-executor'

let root: string
let originalHome: string | undefined
let runtime: HomeChatAssistantRuntime
let originalShell: string | undefined
let wakes: RecordedWake[]

const LOGIN_SHELLS = ['/bin/sh', '/bin/bash', '/bin/zsh', '/usr/bin/fish'].filter((shell) =>
  existsSync(shell)
)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'home-chat-jobs-'))
  // Jobs live under ~/.seal/jobs on the target machine.
  originalHome = process.env.HOME
  originalShell = process.env.SHELL
  process.env.HOME = root
  const local = createLocalMachine()
  ;({ runtime, wakes } = createTestHomeChatRuntime(join(root, 'state'), {
    list: () => Promise.resolve([local.info]),
    open: () => Promise.resolve(local)
  }))
  await runtime.load()
})

afterEach(async () => {
  runtime.dispose()
  process.env.HOME = originalHome
  process.env.SHELL = originalShell
  await rm(root, { recursive: true, force: true })
})

function jobIdFrom(text: string): string {
  const id = text.match(/background job (\w+)/)?.[1]
  if (!id) {
    throw new Error(`no job id in: ${text}`)
  }
  return id
}

describe.skipIf(process.platform === 'win32')('run_command background jobs', () => {
  it('returns the exit code and output of a quick command', async () => {
    const result = await executeHomeChatTool(
      'run_command',
      { machine: 'local', command: 'echo hello; exit 3' },
      testToolContext(runtime)
    )
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/^exit code 3/)
    expect(result.text).toContain('hello')
  })

  it.each(LOGIN_SHELLS)('runs a command when the login shell is %s', async (shell) => {
    process.env.SHELL = shell
    const result = await executeHomeChatTool(
      'run_command',
      {
        machine: 'local',
        command: 'v="two  words"; printf \'%s|%s\\n\' "$v" \'$HOME *\'; echo oops >&2; exit 4'
      },
      testToolContext(runtime)
    )
    expect(result.text).toBe('exit code 4\n\noutput (stdout+stderr):\ntwo  words|$HOME *\noops')
  })

  it('keeps a slow command running and reports into the chat when it exits', async () => {
    const result = await executeHomeChatTool(
      'run_command',
      { machine: 'local', command: 'echo started; sleep 2; echo finished', timeout_seconds: 1 },
      testToolContext(runtime, 'chat-a')
    )
    expect(result.isError).toBe(false)
    expect(result.text).toContain('Still running after 1s')
    expect(result.text).toContain('started')
    const id = jobIdFrom(result.text)

    await expect.poll(() => wakes.length, { timeout: 20_000, interval: 200 }).toBe(1)
    expect(wakes[0]).toMatchObject({ chatId: 'chat-a', source: 'job' })
    expect(wakes[0].text).toContain(`Background job ${id} on `)
    expect(wakes[0].text).toContain('exited with code 0')
    expect(wakes[0].text).toContain('finished')
  })

  it('stops a background job with job_kill', async () => {
    const ctx = testToolContext(runtime)
    const started = await executeHomeChatTool(
      'run_command',
      { machine: 'local', command: 'sleep 60', background: true },
      ctx
    )
    const id = jobIdFrom(started.text)

    const killed = await executeHomeChatTool('job_kill', { job_id: id }, ctx)
    expect(killed.text).toMatch(new RegExp(`^Stopped job ${id} on `))

    const status = await executeHomeChatTool('job_status', { job_id: id }, ctx)
    expect(status.text).not.toContain('running (pid')
  })
})
