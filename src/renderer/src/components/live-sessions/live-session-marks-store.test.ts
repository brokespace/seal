import { describe, expect, it } from 'vitest'
import { LiveSessionMarksStore } from './live-session-marks-store'

function storeWithJoin() {
  const started: LiveSessionMarksStore[] = []
  const store = new LiveSessionMarksStore({}, (joined) => {
    started.push(joined)
    return () => {}
  })
  return { store, started }
}

describe('LiveSessionMarksStore join', () => {
  it('starts its join once, on the first baseline', () => {
    const { store, started } = storeWithJoin()
    expect(started).toEqual([])

    store.baseline([{ id: 'local:claude:a', lastActivityAt: 1000 }])
    store.subscribe(() => {})
    store.baseline([{ id: 'local:claude:b', lastActivityAt: 2000 }])

    expect(started).toEqual([store])
  })

  it('starts its join once, on the first subscription', () => {
    const { store, started } = storeWithJoin()

    store.subscribe(() => {})
    store.subscribe(() => {})
    store.baseline([])

    expect(started).toEqual([store])
  })

  it('lets its join subscribe to it while starting', () => {
    const started: LiveSessionMarksStore[] = []
    const store = new LiveSessionMarksStore({}, (joined) => {
      started.push(joined)
      return joined.subscribe(() => {})
    })

    store.baseline([])

    expect(started).toEqual([store])
  })
})
