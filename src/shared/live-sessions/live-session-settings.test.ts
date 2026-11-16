import { describe, expect, it } from 'vitest'
import { migrateLiveSessionsNotify, outsideSessionsMuted } from './live-session-settings'

describe('the legacy session notification switch', () => {
  it('stays off without touching any other notification setting', () => {
    expect(migrateLiveSessionsNotify({ liveSessionsNotify: false })).toBeNull()
    expect(outsideSessionsMuted({ liveSessionsNotify: false })).toBe(true)
  })

  it('is dropped when it was on', () => {
    expect(migrateLiveSessionsNotify({ liveSessionsNotify: true })).toStrictEqual({
      liveSessionsNotify: undefined
    })
    expect(outsideSessionsMuted({ liveSessionsNotify: true })).toBe(false)
  })

  it('leaves a profile that never set it alone', () => {
    expect(migrateLiveSessionsNotify({})).toBeNull()
    expect(outsideSessionsMuted({})).toBe(false)
  })
})
