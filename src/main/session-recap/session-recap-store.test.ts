import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  emptySessionRecap,
  type SessionRecap
} from '../../shared/session-recap/session-recap-types'
import { SessionRecapStore } from './session-recap-store'

function recap(): SessionRecap {
  return {
    ...emptySessionRecap(1_000),
    questions: [{ id: 'q1', text: 'Drop the audit table?', messageId: 'o10', at: 1_000 }],
    actions: [
      { id: 't2', text: 'Set the deploy secret', messageId: 'o20', at: 1_000 },
      { id: 't3', text: 'Review PR #18', messageId: null, at: 1_000 }
    ],
    nextItemId: 4
  }
}

async function tempPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'seal-recap-store-')), 'recaps.json')
}

describe('SessionRecapStore', () => {
  it('keeps ticks and dismissals across a restart', async () => {
    const path = await tempPath()
    const store = new SessionRecapStore(path)
    store.setRecap('s1', recap(), {})
    store.mark('s1', 't2', 'done')
    store.mark('s1', 'q1', 'dismissed')
    store.mark('s1', 't3', 'done')
    store.mark('s1', 't3', null)
    await store.flush()

    const reopened = new SessionRecapStore(path)
    await reopened.load()

    expect(reopened.get('s1')?.marks).toEqual({ t2: 'done', q1: 'dismissed' })
    expect(reopened.get('s1')?.recap?.actions.map((item) => item.id)).toEqual(['t2', 't3'])
  })

  it('follows a session to the id it is resumed under', async () => {
    const store = new SessionRecapStore(await tempPath())
    store.setRecap('old', recap(), {})
    store.mark('old', 't2', 'done')

    store.move('old', 'new')

    expect(store.get('old')).toBeNull()
    expect(store.get('new')?.marks).toEqual({ t2: 'done' })
  })

  it('drops a tick whose item the recap no longer holds, and refuses one for an unknown item', async () => {
    const store = new SessionRecapStore(await tempPath())
    store.setRecap('s1', recap(), {})
    store.mark('s1', 'q1', 'done')

    expect(store.mark('s1', 'q9', 'done')).toBe(false)
    const stored = store.setRecap('s1', { ...recap(), questions: [] }, store.get('s1')?.marks ?? {})

    expect(stored.marks).toEqual({})
  })

  it('reports the visit before this one, not a reopening minutes later', async () => {
    const store = new SessionRecapStore(await tempPath())
    const HOUR = 3_600_000

    expect(store.look('s1', HOUR)).toBeNull()
    expect(store.look('s1', HOUR + 60_000)).toBeNull()
    expect(store.look('s1', 3 * HOUR)).toBe(HOUR + 60_000)
    expect(store.look('s1', 3 * HOUR + 60_000)).toBe(HOUR + 60_000)
  })
})
