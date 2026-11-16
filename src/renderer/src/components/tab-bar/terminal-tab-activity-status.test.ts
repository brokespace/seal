import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentStatusEntry } from '../../../../shared/agent-status/contracts/agent-status-types'
import { liveSessionPaneStatuses } from '../../../../shared/live-sessions/live-session-pane-activity'
import type { TerminalTab } from '../../../../shared/workspace-layout/terminal-tab-types'
import {
  resetUnreadAgentCompletionTabIdsCacheForTest,
  resetTerminalTabActivityFlagsCacheForTest,
  resolveTerminalTabActivityStatus
} from './terminal-tab-activity-status'

const TAB_ID = 'tab-1'
const FIRST_LEAF_ID = '11111111-1111-4111-8111-111111111111'

const NOW = 10_000

const TAB: Pick<TerminalTab, 'id' | 'title'> = { id: TAB_ID, title: 'Codex' }

function entry(
  leafId: string,
  state: AgentStatusEntry['state'],
  overrides: Partial<AgentStatusEntry> = {}
): AgentStatusEntry {
  const paneKey = `${TAB_ID}:${leafId}`
  return {
    paneKey,
    state,
    prompt: '',
    updatedAt: NOW,
    stateStartedAt: NOW,
    stateHistory: [],
    agentType: 'codex',
    ...overrides
  }
}

/** One live PTY for the tab so title/liveness gates pass. */
const LIVE_PTY = { [TAB_ID]: ['pty-1'] }

beforeEach(() => {
  resetTerminalTabActivityFlagsCacheForTest()
  resetUnreadAgentCompletionTabIdsCacheForTest()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  resetTerminalTabActivityFlagsCacheForTest()
  resetUnreadAgentCompletionTabIdsCacheForTest()
})

describe('resolveTerminalTabActivityStatus', () => {
  it('de-spins a stale working tab on an epoch bump without a new map reference', () => {
    // Freshness epochs can stale a row without replacing its map; invalidate cached flags so abandoned tabs stop spinning.
    const working = entry(FIRST_LEAF_ID, 'working')
    const agentStatusByPaneKey = { [working.paneKey]: working }
    expect(
      resolveTerminalTabActivityStatus({
        tab: TAB,
        agentStatusByPaneKey,
        agentStatusEpoch: 0,
        ptyIdsByTabId: LIVE_PTY
      })
    ).toBe('working')

    vi.setSystemTime(31 * 60 * 1000)
    expect(
      resolveTerminalTabActivityStatus({
        tab: TAB,
        agentStatusByPaneKey,
        agentStatusEpoch: 1,
        ptyIdsByTabId: LIVE_PTY
      })
    ).toBe('active')
  })

  // A pane's session is the same agent as its hook row; the tab shows what the session's row shows.
  it.each([
    { row: 'done', session: 'waiting-task', tab: 'monitoring' },
    { row: 'done', session: 'waiting-subagent', tab: 'working' },
    { row: 'done', session: 'errored', tab: 'failed' },
    { row: 'working', session: 'your-turn', tab: 'done' },
    { row: 'working', session: 'needs-permission', tab: 'permission' },
    { row: 'working', session: 'done', tab: 'working' }
  ] as const)(
    'a pane whose hooks say $row and whose session discovery read as $session shows $tab',
    ({ row, session, tab }) => {
      const pane = entry(FIRST_LEAF_ID, row)
      expect(
        resolveTerminalTabActivityStatus({
          tab: TAB,
          agentStatusByPaneKey: { [pane.paneKey]: pane },
          agentStatusEpoch: 0,
          ptyIdsByTabId: LIVE_PTY,
          sessionStatuses: liveSessionPaneStatuses([
            {
              status: session,
              statusSource: 'transcript',
              inputRoutes: [{ kind: 'seal-pane', paneKey: pane.paneKey }]
            }
          ])
        })
      ).toBe(tab)
    }
  )

  it('reads the hook row where the session took its status from it', () => {
    const pane = entry(FIRST_LEAF_ID, 'working')
    expect(
      resolveTerminalTabActivityStatus({
        tab: TAB,
        agentStatusByPaneKey: { [pane.paneKey]: pane },
        agentStatusEpoch: 0,
        ptyIdsByTabId: LIVE_PTY,
        sessionStatuses: liveSessionPaneStatuses([
          {
            status: 'your-turn',
            statusSource: 'seal-hooks',
            inputRoutes: [{ kind: 'seal-pane', paneKey: pane.paneKey }]
          }
        ])
      })
    ).toBe('working')
  })
})
