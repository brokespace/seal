// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { SAMPLE_NOW, sampleLiveSession } from '../live-session.test-fixture'
import { LiveSessionRow } from './LiveSessionRow'

afterEach(cleanup)

function renderRow(session: LiveSession): void {
  render(
    <LiveSessionRow
      session={session}
      workspaceName={null}
      account={null}
      unread={false}
      current={false}
      highlighted={false}
      picked={null}
      tabStop
      now={SAMPLE_NOW}
      onOpen={() => {}}
      onPick={() => {}}
      menu={() => null}
    />
  )
}

const recap = { title: 'Fix login redirect loop', rev: 3, questions: 0, actions: 0 }

it('labels a session the user has not named with its recap title', () => {
  renderRow(sampleLiveSession('a', { title: 'the login thing is broken again', recap }))

  expect(screen.getByText('Fix login redirect loop')).toBeInTheDocument()
  expect(screen.queryByText('the login thing is broken again')).not.toBeInTheDocument()
})

it('keeps the name the user gave a session over its recap title', () => {
  renderRow(
    sampleLiveSession('a', {
      title: 'the login thing is broken again',
      customTitle: 'Login bug',
      recap
    })
  )

  expect(screen.getByText('Login bug')).toBeInTheDocument()
  expect(screen.queryByText('Fix login redirect loop')).not.toBeInTheDocument()
})

it('badges a session with what still waits on the user, and not one with nothing open', () => {
  renderRow(sampleLiveSession('a', { recap: { ...recap, questions: 3, actions: 1 } }))
  expect(document.querySelector('[data-session-recap-badge]')).toHaveTextContent('31')

  cleanup()
  renderRow(sampleLiveSession('a', { recap }))
  expect(document.querySelector('[data-session-recap-badge]')).toBeNull()
})
