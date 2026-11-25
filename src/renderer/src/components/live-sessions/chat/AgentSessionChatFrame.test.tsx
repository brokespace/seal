// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { sampleRecapView, sampleSessionRecap } from '../../session-recap/session-recap.test-fixture'
import type { SessionRecapModel } from '../../session-recap/use-session-recap'
import { SAMPLE_NOW, sampleLiveSession } from '../live-session.test-fixture'
import { requestAgentSessionFocus } from './agent-session-focus-requests'
import { AgentSessionChatFrameView } from './AgentSessionChatFrame'

// The session menu reaches every way a session opens; the frame only mounts it.
vi.mock('../menu/LiveSessionMenuItems', () => ({
  DROPDOWN_MENU_KIT: {},
  LiveSessionMenuItems: () => null
}))

afterEach(cleanup)

it('keeps the chat and what was typed in it when its record appears and when it goes', () => {
  const frame = (session: LiveSession | null): React.JSX.Element => (
    <AgentSessionChatFrameView session={session} isVisible>
      <textarea aria-label="Message" />
    </AgentSessionChatFrameView>
  )
  const { rerender } = render(frame(null))
  const chat = screen.getByLabelText<HTMLTextAreaElement>('Message')
  chat.value = 'half a message'

  rerender(frame(sampleLiveSession('local:claude:one', { title: 'Fix the login bug' })))
  expect(screen.getByRole('heading', { name: 'Fix the login bug' })).toBeTruthy()
  expect(screen.getByLabelText('Message')).toBe(chat)

  rerender(frame(null))
  expect(screen.queryByRole('heading', { name: 'Fix the login bug' })).toBeNull()
  expect(screen.getByLabelText('Message')).toBe(chat)
  expect(chat.value).toBe('half a message')
})

it('offers a recap item as a jump only to a chat that can scroll to its message', () => {
  const session = sampleLiveSession('local:claude:billing')
  const recap: SessionRecapModel = {
    view: sampleRecapView({
      recap: sampleSessionRecap({
        requests: [
          {
            id: 'a1',
            text: 'Find the double charge',
            messageId: 'o400',
            at: SAMPLE_NOW - 60_000,
            status: 'open',
            statusAt: SAMPLE_NOW - 60_000
          }
        ]
      })
    }),
    refreshing: false,
    failed: null,
    refresh: () => {},
    mark: () => {}
  }
  const onRevealMessage = vi.fn()
  const frame = (reveal?: (messageId: string) => void): React.JSX.Element => (
    <AgentSessionChatFrameView session={session} isVisible recap={recap} onRevealMessage={reveal}>
      <div />
    </AgentSessionChatFrameView>
  )
  const { container, rerender } = render(frame(onRevealMessage))
  fireEvent.click(container.querySelector('[data-live-session-panel-toggle="recap"]')!)

  fireEvent.click(screen.getByRole('button', { name: 'Find the double charge' }))
  expect(onRevealMessage.mock.calls).toEqual([['o400']])

  rerender(frame(undefined))
  expect(screen.getByText('Find the double charge')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Find the double charge' })).toBeNull()
})

it('opens the panel a menu asked for, and not again when the chat is mounted again', () => {
  const session = sampleLiveSession('local:claude:tasks')
  const frame = (
    <AgentSessionChatFrameView session={session} isVisible>
      <div />
    </AgentSessionChatFrameView>
  )
  requestAgentSessionFocus(session.id, 'tasks')

  const first = render(frame)
  expect(first.container.querySelector('[data-live-session-panel="tasks"]')).not.toBeNull()
  first.unmount()

  const second = render(frame)
  expect(second.container.querySelector('[data-live-session-panel="tasks"]')).toBeNull()
})
