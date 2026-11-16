import { describe, expect, it } from 'vitest'
import { closesProjectVisit, LiveSessionTabsStore } from './live-session-tabs-store'

function closing(store: LiveSessionTabsStore, sessionId: string, project = 'shop'): boolean {
  const before = store.getState()
  store.close(sessionId)
  return closesProjectVisit(before, store.getState(), sessionId, project)
}

describe('closing session tabs opened from a project overview', () => {
  it('ends the visit with the last tab opened from the overview, not with an earlier one', () => {
    const store = new LiveSessionTabsStore()
    store.open('kept-from-before', 'tab')
    store.open('first', 'tab', 'shop')
    store.open('second', 'tab', 'shop')

    expect(closing(store, 'second')).toBe(false)
    expect(closing(store, 'first')).toBe(true)
    expect(store.getState().tabs).toEqual(['kept-from-before'])
  })

  it('stays while tabs remain, unless the closed one was on screen and opened from the overview', () => {
    const store = new LiveSessionTabsStore()
    store.open('from-sidebar', 'tab')
    store.open('from-overview', 'tab', 'shop')
    store.open('on-screen', 'tab')

    expect(closing(store, 'from-overview')).toBe(false)
    expect(closing(store, 'on-screen')).toBe(false)
    expect(closing(store, 'from-sidebar')).toBe(true)
  })

  it("does not count a tab opened from another project's overview", () => {
    const store = new LiveSessionTabsStore()
    store.open('from-api-overview', 'tab', 'api')
    store.open('from-shop-overview', 'tab', 'shop')

    expect(closing(store, 'from-shop-overview', 'shop')).toBe(true)
  })
})

describe('moving session tabs', () => {
  it('puts a tab before the one at the given place, and at the end past the last', () => {
    const store = new LiveSessionTabsStore()
    for (const id of ['a', 'b', 'c', 'd']) {
      store.open(id, 'tab')
    }
    store.move(['a'], 3)
    expect(store.getState().tabs).toEqual(['b', 'c', 'a', 'd'])
    store.move(['d'], 0)
    expect(store.getState().tabs).toEqual(['d', 'b', 'c', 'a'])
    store.move(['d'], 4)
    expect(store.getState().tabs).toEqual(['b', 'c', 'a', 'd'])
    expect(store.getState().activeId).toBe('d')
  })
})
