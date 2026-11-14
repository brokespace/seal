// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { HomeChatApi } from '../../../../preload/api/home-chat/home-chat-api'
import { HomeChatSlot } from './HomeChatSlot'

const idleHomeChat: Partial<HomeChatApi> = {
  list: async () => [],
  getSettings: async () => ({
    defaultBackend: 'claude-code',
    openai: { baseUrl: '', model: '', apiKeyConfigured: false, contextWindow: 128_000 },
    web: { searchProvider: 'duckduckgo', searxngUrl: '', searchApiKeyConfigured: false }
  }),
  listAccounts: async () => [],
  listMachines: async () => [],
  onEvent: () => () => {}
}

function renderSlot(): HTMLElement {
  const { container } = render(
    <TooltipProvider>
      <HomeChatSlot />
    </TooltipProvider>
  )
  return container.querySelector('[data-home-slot="chat"]')!
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('api', { homeChat: idleHomeChat })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('minimizes and expands the Home chat, and reopens the way it was left', () => {
  let slot = renderSlot()
  expect(slot).not.toHaveAttribute('data-minimized')

  fireEvent.click(screen.getByRole('button', { name: 'Minimize chat' }))
  expect(slot).toHaveAttribute('data-minimized', 'true')
  expect(screen.getByRole('button', { name: 'Expand chat' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )

  // A restart mounts Home again from scratch.
  cleanup()
  slot = renderSlot()
  expect(slot).toHaveAttribute('data-minimized', 'true')

  fireEvent.click(screen.getByRole('button', { name: 'Expand chat' }))
  expect(slot).not.toHaveAttribute('data-minimized')

  cleanup()
  slot = renderSlot()
  expect(slot).not.toHaveAttribute('data-minimized')
  expect(screen.getByRole('button', { name: 'Minimize chat' })).toBeInTheDocument()
})
