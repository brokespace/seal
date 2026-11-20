import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useKeyboardPersistingTaps } from './keyboard-persisting-taps'

// React Native's native runtime defines a global HTMLElement for its host views, with no DOM methods.
class NativeHostView {}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useKeyboardPersistingTaps on a native runtime', () => {
  it('attaches nothing to a native host view', () => {
    vi.stubGlobal('HTMLElement', NativeHostView)
    let attach: ((node: unknown) => void) | null = null
    function Probe() {
      attach = useKeyboardPersistingTaps('always')
      return null
    }
    act(() => {
      create(createElement(Probe))
    })
    expect(() => attach?.(new NativeHostView())).not.toThrow()
  })
})
