import { afterEach, describe, expect, it, vi } from 'vitest'
import { SplitViewStore } from './split-view-store'

function stubStorage(entries: Record<string, string>): Map<string, string> {
  const storage = new Map(Object.entries(entries))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key)
  })
  return storage
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SplitViewStore', () => {
  it('saves the layout it made from the session page two-up as soon as it is made', () => {
    const storage = stubStorage({
      'seal.liveSessionTabs.v1': JSON.stringify({
        tabs: ['host:a', 'host:b', 'host:c'],
        activeId: 'host:a',
        splitId: 'host:c'
      })
    })

    const [first, second] = Object.keys(new SplitViewStore().getState().panes)
    const saved: unknown = JSON.parse(storage.get('seal.splitView.v1') ?? 'null')

    expect(saved).toEqual({
      layout: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: first },
        second: { type: 'leaf', groupId: second },
        ratio: 0.5
      },
      panes: {
        [first]: {
          items: [
            { kind: 'session', sessionId: 'host:a' },
            { kind: 'session', sessionId: 'host:b' }
          ],
          activeKey: 'session:host:a'
        },
        [second]: {
          items: [{ kind: 'session', sessionId: 'host:c' }],
          activeKey: 'session:host:c'
        }
      },
      focusedPaneId: first
    })
  })
})
