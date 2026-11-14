// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { HomeSession } from './home-overview-model'
import { HomeSessionRow } from './HomeSessionRow'

const RAW_MESSAGE = 'I pushed the branch, opened PR #12 and added tests for the switch path.'

function renderRow(overrides: Partial<HomeSession>): void {
  const session: HomeSession = {
    id: 'pane-1',
    state: 'done',
    unseen: false,
    machineId: 'local',
    machineLabel: 'Local Mac',
    projectId: 'seal',
    projectName: 'seal',
    workspaceName: 'main',
    title: 'Multi-account switcher',
    agentType: 'claude',
    agentLabel: 'Claude',
    startedAt: 1_000,
    stateChangedAt: 2_000,
    finishedAt: 2_000,
    lastMessage: { role: 'agent', text: RAW_MESSAGE },
    target: { kind: 'live-session', sessionId: 'pane-1' },
    ...overrides
  }
  render(
    <TooltipProvider>
      <ul>
        <HomeSessionRow session={session} now={3_000} onOpen={() => {}} />
      </ul>
    </TooltipProvider>
  )
}

afterEach(cleanup)

describe('HomeSessionRow session summary', () => {
  it('shows the summary under the title in place of the raw last message', () => {
    renderRow({ summary: { text: 'Opened PR #12 with the account picker.', pending: false } })

    expect(screen.getByText('Opened PR #12 with the account picker.')).toBeInTheDocument()
    expect(screen.queryByText(RAW_MESSAGE)).not.toBeInTheDocument()
  })

  it('holds the line with a placeholder while the summary is being written', () => {
    renderRow({ summary: { text: null, pending: true } })

    expect(screen.getByRole('status', { name: 'Summarizing…' })).toBeInTheDocument()
    expect(screen.queryByText(RAW_MESSAGE)).not.toBeInTheDocument()
  })

  it('shows the last message when the session has no summary', () => {
    renderRow({})

    expect(screen.getByText(RAW_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps an approval prompt as the literal ask', () => {
    renderRow({
      state: 'permission',
      askSummary: 'Run `pnpm build:icons`?',
      summary: { text: 'Rebuilt the icon set.', pending: false }
    })

    expect(screen.getByText('Run `pnpm build:icons`?')).toBeInTheDocument()
    expect(screen.queryByText('Rebuilt the icon set.')).not.toBeInTheDocument()
  })
})
