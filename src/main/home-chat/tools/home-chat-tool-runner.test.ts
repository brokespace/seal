import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HomeChatEntry } from '../../../shared/home-chat/home-chat-types'
import { RepeatGuard } from '../engine/home-chat-repeat-guard'
import { HomeChatTurnRecorder } from '../engine/home-chat-turn-recorder'
import { HomeChatApprovals } from '../home-chat-approvals'
import { createLocalMachine } from '../machines/home-chat-local-machine'
import { createTestHomeChatRuntime } from '../testing/home-chat-runtime.test-support'
import type { HomeChatThread } from '../thread/home-chat-thread'
import { HomeChatThreadStore } from '../thread/home-chat-thread-store'
import { runHomeChatToolCall, type HomeChatToolRunContext } from './home-chat-tool-runner'

let dir: string
let thread: HomeChatThread

async function context(approvals = new HomeChatApprovals()): Promise<HomeChatToolRunContext> {
  const local = createLocalMachine()
  const machines = { list: () => Promise.resolve([local.info]), open: () => Promise.resolve(local) }
  const threads = await HomeChatThreadStore.open(join(dir, 'state'))
  thread = threads.create({ backend: 'openai-compatible', accountId: null, model: null })
  return {
    chatId: thread.id,
    approvals,
    recorder: new HomeChatTurnRecorder(thread, () => undefined),
    guard: new RepeatGuard(),
    machines,
    runOrcaCli: () => Promise.reject(new Error('unused')),
    services: createTestHomeChatRuntime(join(dir, 'runtime'), machines).runtime.services
  }
}

function toolEntry(): Extract<HomeChatEntry, { kind: 'tool' }> | undefined {
  return thread?.entries.find((entry) => entry.kind === 'tool')
}

async function pendingToolEntry(): Promise<Extract<HomeChatEntry, { kind: 'tool' }>> {
  await expect.poll(() => toolEntry()?.status).toBe('awaiting-approval')
  const entry = toolEntry()
  if (!entry) {
    throw new Error('no tool entry')
  }
  return entry
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'home-chat-runner-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('runHomeChatToolCall', () => {
  it('waits on the approval card and leaves the file alone when the user declines', async () => {
    const target = join(dir, 'keep.txt')
    writeFileSync(target, 'data')
    const approvals = new HomeChatApprovals()
    const ctx = await context(approvals)
    const result = runHomeChatToolCall(
      { callId: 'c1', tool: 'delete_path', input: { machine: 'local', path: target } },
      ctx
    )

    const pending = await pendingToolEntry()
    expect(approvals.respond(thread.id, pending.id, false)).toBe(true)

    expect(await result).toMatchObject({ outcome: 'denied' })
    expect(existsSync(target)).toBe(true)
    expect(toolEntry()).toMatchObject({ status: 'denied' })
  })

  it('runs the action once approved', async () => {
    const target = join(dir, 'gone.txt')
    writeFileSync(target, 'data')
    const approvals = new HomeChatApprovals()
    const ctx = await context(approvals)
    const result = runHomeChatToolCall(
      { callId: 'c1', tool: 'delete_path', input: { machine: 'local', path: target } },
      ctx
    )

    approvals.respond(thread.id, (await pendingToolEntry()).id, true)

    expect(await result).toMatchObject({ outcome: 'ok' })
    expect(existsSync(target)).toBe(false)
  })

  it('answers a call it cannot run with what to fix instead of throwing', async () => {
    const ctx = await context()
    const invalid = await runHomeChatToolCall(
      { callId: 'c1', tool: 'run_command', input: { machine: 'local' } },
      ctx
    )
    expect(invalid.outcome).toBe('refusal')
    expect(invalid.text).toContain('run_command was not run: its arguments are invalid.')
    expect(invalid.text).toContain('- command:')

    const unknown = await runHomeChatToolCall(
      { callId: 'c2', tool: 'mcp__seal__run_comand', input: {} },
      ctx
    )
    expect(unknown.text).toBe(
      'There is no tool named "mcp__seal__run_comand", so nothing ran. Did you mean run_command?'
    )
  })

  it('stops running an identical call that keeps failing', async () => {
    const ctx = await context()
    const call = (callId: string) =>
      runHomeChatToolCall(
        { callId, tool: 'read_file', input: { machine: 'local', path: join(dir, 'missing.txt') } },
        ctx
      )
    expect((await call('c1')).outcome).toBe('error')
    expect((await call('c2')).text).toContain('Repeating it will not help')
    expect((await call('c3')).text).toContain('It will not be run again this turn')
    expect(await call('c4')).toMatchObject({
      outcome: 'refusal',
      text: 'read_file was not run: the identical call already failed repeatedly this turn. Take a different approach, or tell the user what is blocking you.'
    })
  })
})
