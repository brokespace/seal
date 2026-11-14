// @vitest-environment happy-dom

import { cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useMobilePageEscape } from './use-mobile-page-escape'

afterEach(cleanup)

it('leaves the page open on the Escape that was pressed before the page was on screen', () => {
  const pressedOnThePageAbove = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  const onClose = vi.fn()
  renderHook(() => useMobilePageEscape(onClose))

  document.body.dispatchEvent(pressedOnThePageAbove)
  expect(onClose).not.toHaveBeenCalled()

  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
})
