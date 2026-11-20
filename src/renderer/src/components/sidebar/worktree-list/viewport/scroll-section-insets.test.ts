import { describe, expect, it } from 'vitest'
import {
  resolveScrollTopAfterLeadingResize,
  resolveScrollTopBeforeLeadingResize
} from './scroll-section-insets'

describe('resolveScrollTopAfterLeadingResize', () => {
  it('keeps the rows in place when a section above them grows while they are being read', () => {
    expect(
      resolveScrollTopAfterLeadingResize({
        scrollTop: 900,
        previous: { leading: 400, pinned: 32 },
        next: { leading: 460, pinned: 32 }
      })
    ).toBe(960)
  })

  it('keeps the rows in place when a section above them shrinks while they are being read', () => {
    expect(
      resolveScrollTopAfterLeadingResize({
        scrollTop: 900,
        previous: { leading: 400, pinned: 32 },
        next: { leading: 36, pinned: 32 }
      })
    ).toBe(536)
  })

  it('does not scroll a list resting at its top when the first section grows', () => {
    expect(
      resolveScrollTopAfterLeadingResize({
        scrollTop: 0,
        previous: { leading: 0, pinned: 32 },
        next: { leading: 400, pinned: 32 }
      })
    ).toBe(0)
  })

  it('stays put inside the leading sections when one of their rows resizes', () => {
    expect(
      resolveScrollTopAfterLeadingResize({
        scrollTop: 200,
        previous: { leading: 500, pinned: 32 },
        next: { leading: 460, pinned: 32 }
      })
    ).toBe(200)
  })

  it('brings a section folded from inside it back to its header', () => {
    expect(
      resolveScrollTopAfterLeadingResize({
        scrollTop: 200,
        previous: { leading: 500, pinned: 32 },
        next: { leading: 36, pinned: 32 }
      })
    ).toBe(4)
  })
})

describe('resolveScrollTopBeforeLeadingResize', () => {
  it('recovers the position the browser clamped away when a section shrank at the end of the list', () => {
    const before = resolveScrollTopBeforeLeadingResize({
      scrollTop: 2753,
      maxScrollTop: 2753,
      lastKnownScrollTop: 2793
    })
    expect(before).toBe(2793)
    expect(
      resolveScrollTopAfterLeadingResize({
        scrollTop: before,
        previous: { leading: 776, pinned: 32 },
        next: { leading: 736, pinned: 32 }
      })
    ).toBe(2753)
  })

  it('trusts the live position away from the end of the list', () => {
    expect(
      resolveScrollTopBeforeLeadingResize({
        scrollTop: 1500,
        maxScrollTop: 2753,
        lastKnownScrollTop: 1620
      })
    ).toBe(1500)
  })
})
