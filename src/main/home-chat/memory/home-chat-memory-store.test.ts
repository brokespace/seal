import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HomeChatMemoryStore } from './home-chat-memory-store'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'home-chat-memory-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('HomeChatMemoryStore', () => {
  it('keeps rules, facts and machine notes across a reload', async () => {
    const store = new HomeChatMemoryStore(root)
    store.remember('rule', 'Always push to a feature branch')
    store.remember('fact', 'The GPU box is called tower')
    store.configureMachine({
      machine: 'hop:lab',
      via: 'ssh:tower',
      host: '10.0.0.7',
      user: 'brian'
    })

    const reloaded = new HomeChatMemoryStore(root)
    await expect.poll(async () => (await reloaded.load(), reloaded.get().rules.length)).toBe(1)
    expect(reloaded.get().rules[0].text).toBe('Always push to a feature branch')
    expect(reloaded.get().facts[0].text).toBe('The GPU box is called tower')
    expect(reloaded.machineNotes()).toEqual([
      { machine: 'hop:lab', notes: '', via: 'ssh:tower', host: '10.0.0.7', user: 'brian' }
    ])
  })

  it('forgets by unique text and refuses an ambiguous match', () => {
    const store = new HomeChatMemoryStore(root)
    store.remember('fact', 'Repo seal lives on tower')
    store.remember('fact', 'Repo orca lives on laptop')

    expect(() => store.forget('Repo')).toThrow(/matches several memories/)
    expect(store.forget('orca').text).toBe('Repo orca lives on laptop')
    expect(store.get().facts.map((item) => item.text)).toEqual(['Repo seal lives on tower'])
  })

  it('does not duplicate a rule it already has', () => {
    const store = new HomeChatMemoryStore(root)
    const first = store.remember('rule', 'Clean up temp files')
    const again = store.remember('rule', 'clean up temp files')
    expect(again.id).toBe(first.id)
    expect(store.get().rules).toHaveLength(1)
  })
})
