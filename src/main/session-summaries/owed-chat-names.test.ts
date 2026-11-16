import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SavedOwedChatNames } from './owed-chat-names'

describe('SavedOwedChatNames', () => {
  let folder: string | null = null

  afterEach(async () => {
    if (folder) {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('still holds an owed name after a restart, and no longer one that was settled', async () => {
    folder = await mkdtemp(join(tmpdir(), 'owed-chat-names-'))
    const path = join(folder, 'owed-chat-names.json')
    const before = new SavedOwedChatNames(path)
    before.set('chat-1', { chatSessionId: 'chat-1', title: 'Fix the build', chatHad: 'Ship it' })
    before.set('chat-2', { chatSessionId: 'chat-2', title: 'Tidy imports' })
    before.delete('chat-2')
    await before.flush()

    const restarted = new SavedOwedChatNames(path)
    await restarted.load()

    expect(restarted.get('chat-1')).toEqual({
      chatSessionId: 'chat-1',
      title: 'Fix the build',
      chatHad: 'Ship it'
    })
    expect(restarted.get('chat-2')).toBeUndefined()
  })
})
