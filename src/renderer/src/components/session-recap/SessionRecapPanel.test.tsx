// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SAMPLE_NOW } from '@/components/live-sessions/live-session.test-fixture'
import type { SessionRecapView } from '../../../../shared/session-recap/session-recap-types'
import { sampleRecapView } from './session-recap.test-fixture'
import { SessionRecapPanel } from './SessionRecapPanel'

afterEach(cleanup)

function renderPanel(view: SessionRecapView | null = sampleRecapView(), refreshing = false) {
  const calls = { onJump: vi.fn(), onMark: vi.fn(), onRefresh: vi.fn() }
  render(
    <SessionRecapPanel
      view={view}
      refreshing={refreshing}
      now={SAMPLE_NOW}
      onRefresh={calls.onRefresh}
      onMark={calls.onMark}
      onJump={calls.onJump}
      onOpenLink={() => {}}
      onClose={() => {}}
    />
  )
  return calls
}

const section = (name: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-recap-section="${name}"]`)
  if (!found) {
    throw new Error(`no ${name} section`)
  }
  return found
}

const itemIds = (root: HTMLElement): (string | null)[] =>
  [...root.querySelectorAll('[data-recap-item]')].map((row) => row.getAttribute('data-recap-item'))

it('takes the reader to the message an item came from', () => {
  const calls = renderPanel()

  fireEvent.click(
    within(section('questions')).getByText(
      'Should the backfill refund duplicates automatically, or only list them for review?'
    )
  )
  fireEvent.click(within(section('references')).getByText('acme/billing#482'))

  expect(calls.onJump.mock.calls).toEqual([['o33410'], ['o31950']])
})

it('ticks an action item done and dismisses a question', () => {
  const calls = renderPanel()

  fireEvent.click(
    within(section('actions')).getByRole('checkbox', {
      name: /Add STRIPE_STAGING_KEY to the staging secrets/
    })
  )
  const dismiss = section('questions').querySelector<HTMLElement>('[data-recap-dismiss="q10"]')
  fireEvent.click(dismiss!)

  expect(calls.onMark.mock.calls).toEqual([
    ['t16', 'done'],
    ['q10', 'dismissed']
  ])
})

it('folds ticked and dismissed items away, and brings one back when it is unticked', () => {
  const calls = renderPanel(sampleRecapView({ marks: { t18: 'done', t17: 'dismissed' } }))

  expect(itemIds(section('actions'))).toEqual(['t16'])

  fireEvent.click(within(section('actions')).getByRole('button', { expanded: false }))
  expect(itemIds(section('actions'))).toEqual(['t16', 't17', 't18'])

  fireEvent.click(
    within(section('actions')).getByRole('checkbox', {
      name: /Tell support which customers were double-charged/
    })
  )
  fireEvent.click(section('actions').querySelector<HTMLElement>('[data-recap-restore="t17"]')!)

  expect(calls.onMark.mock.calls).toEqual([
    ['t18', null],
    ['t17', null]
  ])
})

it('lists what the agent did since the last visit, newest first, and nothing on a first visit', () => {
  renderPanel()
  expect(itemIds(section('news'))).toEqual(['w13', 'w12', 'w9'])

  cleanup()
  renderPanel(sampleRecapView({ since: null }))
  expect(document.querySelector('[data-recap-section="news"]')).toBeNull()
})

it('puts work in progress and blocked work ahead of what is finished', () => {
  renderPanel()

  expect(
    [...section('did').querySelectorAll('[data-recap-work]')].map((row) =>
      row.getAttribute('data-recap-work')
    )
  ).toEqual(['in-progress', 'blocked', 'done', 'done', 'done', 'done'])
})

it('refreshes on demand, and not while a pass is already running', () => {
  const calls = renderPanel()
  const refresh = document.querySelector<HTMLButtonElement>('[data-recap-refresh]')!
  fireEvent.click(refresh)
  expect(calls.onRefresh).toHaveBeenCalledTimes(1)

  cleanup()
  renderPanel(sampleRecapView({ state: 'updating' }))
  expect(document.querySelector<HTMLButtonElement>('[data-recap-refresh]')).toBeDisabled()
})

it('shows no sections before the host has answered', () => {
  renderPanel(null)

  expect(document.querySelector('[data-recap-section]')).toBeNull()
  expect(screen.getByRole('status')).toBeInTheDocument()
})
