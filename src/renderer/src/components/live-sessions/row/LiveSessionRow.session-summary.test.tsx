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

it("shows the host's summary on its own line under the status", () => {
  renderRow(sampleLiveSession('a', { title: 'Fix login', summary: 'Needs approval to deploy.' }))

  expect(screen.getByText('Needs approval to deploy.')).toBeInTheDocument()
})

it('holds the line with a placeholder while the summary is being written', () => {
  renderRow(sampleLiveSession('a', { title: 'Fix login', summaryPending: true }))

  expect(screen.getByRole('status', { name: 'Summarizing…' })).toBeInTheDocument()
})

it('adds no line to a session that has no summary', () => {
  renderRow(sampleLiveSession('a', { title: 'Fix login' }))

  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(document.querySelector('[data-session-summary]')).toBeNull()
})
