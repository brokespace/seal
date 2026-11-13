import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HomeChatStore } from './home-chat-store'

vi.mock('../credentials/encrypted-api-key-file-store', () => ({
  createEncryptedApiKeyFileStore: () => ({
    has: () => false,
    read: () => null,
    save: vi.fn(),
    clear: vi.fn()
  })
}))

let dir: string | null = null

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('HomeChatStore', () => {
  it('reopens a chat saved mid-turn as idle with its unfinished pieces settled', () => {
    dir = mkdtempSync(join(tmpdir(), 'home-chat-store-'))
    const store = new HomeChatStore(dir)
    store.put({
      backendState: { claudeSessionId: 's1' },
      chat: {
        id: 'c1',
        title: 'Deploy',
        backend: 'claude-code',
        accountId: null,
        model: null,
        status: 'running',
        createdAt: 1,
        updatedAt: 2,
        entries: [
          { id: 'a', rev: 4, at: 1, kind: 'assistant', text: 'Deploying', streaming: true },
          {
            id: 't',
            rev: 1,
            at: 2,
            kind: 'tool',
            tool: 'delete_path',
            input: {},
            status: 'awaiting-approval'
          }
        ]
      }
    })
    store.flushAll()

    const reopened = new HomeChatStore(dir).get('c1')

    expect(reopened?.backendState).toEqual({ claudeSessionId: 's1' })
    expect(reopened?.chat.status).toBe('idle')
    expect(reopened?.chat.entries).toEqual([
      { id: 'a', rev: 4, at: 1, kind: 'assistant', text: 'Deploying', streaming: false },
      {
        id: 't',
        rev: 1,
        at: 2,
        kind: 'tool',
        tool: 'delete_path',
        input: {},
        status: 'error',
        output: 'Interrupted when Seal closed.'
      }
    ])
  })
})
