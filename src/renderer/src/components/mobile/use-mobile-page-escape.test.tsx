// @vitest-environment happy-dom

import { cleanup, fireEvent, render, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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

function PageUnderTooltip({
  onClose,
  onButtonKeyDown
}: {
  onClose: () => void
  onButtonKeyDown?: (event: React.KeyboardEvent) => void
}): React.JSX.Element {
  useMobilePageEscape(onClose)
  return (
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger onKeyDown={onButtonKeyDown}>Hint</TooltipTrigger>
        <TooltipContent>Label</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

it('closes the page on an Escape that an open tooltip took only to close itself', () => {
  const onClose = vi.fn()
  render(<PageUnderTooltip onClose={onClose} />)

  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
})

it('leaves the page open when a control under an open tooltip takes the Escape', () => {
  const onClose = vi.fn()
  const view = render(
    <PageUnderTooltip onClose={onClose} onButtonKeyDown={(event) => event.preventDefault()} />
  )

  fireEvent.keyDown(view.getByRole('button'), { key: 'Escape' })
  expect(onClose).not.toHaveBeenCalled()
})
