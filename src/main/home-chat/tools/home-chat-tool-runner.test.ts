import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mergeHomeChatEntry } from '../../../shared/home-chat/home-chat-entry-merge'
import type { HomeChatEntry } from '../../../shared/home-chat/home-chat-types'
import { HomeChatApprovals } from '../home-chat-approvals'
import { HomeChatEntryWriter } from '../home-chat-entry-writer'
import { createLocalMachine } from '../machines/home-chat-local-machine'
import { runHomeChatToolCall, type HomeChatToolRunContext } from './home-chat-tool-runner'

let dir: string
let entries: HomeChatEntry[]

function context(approvals: HomeChatApprovals): HomeChatToolRunContext {
  const local = createLocalMachine()
  return {
    chatId: 'c1',
    approvals,
    writer: new HomeChatEntryWriter((entry) => {
      entries = mergeHomeChatEntry(entries, entry)
    }),
    machines: { list: () => Promise.resolve([local.info]), open: () => Promise.resolve(local) },
    runOrcaCli: () => Promise.reject(new Error('unused'))
  }
}

async function pendingToolEntry(): Promise<Extract<HomeChatEntry, { kind: 'tool' }>> {
  await expect.poll(() => entries.find((e) => e.kind === 'tool')?.kind).toBe('tool')
  const entry = entries.find((e) => e.kind === 'tool')
  if (entry?.kind !== 'tool') {
    throw new Error('no tool entry')
  }
  return entry
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'home-chat-runner-'))
  entries = []
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('runHomeChatToolCall', () => {
  it('waits on the approval card and leaves the file alone when the user declines', async () => {
    const target = join(dir, 'keep.txt')
    writeFileSync(target, 'data')
    const approvals = new HomeChatApprovals()
    const result = runHomeChatToolCall(
      'delete_path',
      { machine: 'local', path: target },
      context(approvals)
    )

    const pending = await pendingToolEntry()
    expect(pending.status).toBe('awaiting-approval')
    expect(approvals.respond('c1', pending.id, false)).toBe(true)

    expect(await result).toMatchObject({ isError: true })
    expect(existsSync(target)).toBe(true)
    expect(entries.find((e) => e.id === pending.id)).toMatchObject({ status: 'denied' })
  })

  it('runs the action once approved', async () => {
    const target = join(dir, 'gone.txt')
    writeFileSync(target, 'data')
    const approvals = new HomeChatApprovals()
    const result = runHomeChatToolCall(
      'delete_path',
      { machine: 'local', path: target },
      context(approvals)
    )

    approvals.respond('c1', (await pendingToolEntry()).id, true)

    expect(await result).toMatchObject({ isError: false })
    expect(existsSync(target)).toBe(false)
  })

  it('rejects arguments that do not match the tool schema without rendering a call', async () => {
    const result = await runHomeChatToolCall(
      'run_command',
      { machine: 'local' },
      context(new HomeChatApprovals())
    )
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/^Invalid arguments for run_command/)
    expect(entries).toEqual([])
  })
})
