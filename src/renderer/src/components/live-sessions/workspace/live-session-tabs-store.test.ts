import { describe, expect, it } from 'vitest'
import { closesProjectVisit, LiveSessionTabsStore } from './live-session-tabs-store'

function closing(store: LiveSessionTabsStore, sessionId: string): boolean {
  const before = store.getState()
  store.close(sessionId)
  return closesProjectVisit(before, store.getState(), sessionId)
}

describe('closing session tabs opened from a project overview', () => {
  it('ends the visit with the last tab opened from the overview, not with an earlier one', () => {
    const store = new LiveSessionTabsStore()
    store.open('kept-from-before', 'tab')
    store.open('first', 'tab', true)
    store.open('second', 'tab', true)

    expect(closing(store, 'second')).toBe(false)
    expect(closing(store, 'first')).toBe(true)
    expect(store.getState().tabs).toEqual(['kept-from-before'])
  })

  it('stays while tabs remain, unless the closed one was on screen and opened from the overview', () => {
    const store = new LiveSessionTabsStore()
    store.open('from-sidebar', 'tab')
    store.open('from-overview', 'tab', true)
    store.open('on-screen', 'tab')

    expect(closing(store, 'from-overview')).toBe(false)
    expect(closing(store, 'on-screen')).toBe(false)
    expect(closing(store, 'from-sidebar')).toBe(true)
  })
})
