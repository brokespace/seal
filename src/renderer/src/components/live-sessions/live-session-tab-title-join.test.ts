import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { joinLiveSessionTitlesWithTabTitles } from './live-session-tab-title-join'
import { sampleLiveSession } from './live-session.test-fixture'

const LEFT_PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'
const RIGHT_PANE_KEY = 'tab-1:22222222-2222-4222-8222-222222222222'

type Tabs = Record<string, { id: string; customTitle: string | null }[]>

const cliSession = sampleLiveSession('local:claude:cli', {
  surface: { kind: 'cli', paneKey: LEFT_PANE_KEY }
})

function startJoin(options: { tabTitle: string | null; sessions: LiveSession[] }) {
  let tabs: Tabs = { 'worktree-1': [{ id: 'tab-1', customTitle: options.tabTitle }] }
  const listeners = new Set<() => void>()
  const annotated: [sessionId: string, customTitle: string | null][] = []
  joinLiveSessionTitlesWithTabTitles({
    tabs: {
      get: () => tabs,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    },
    sessions: { get: () => options.sessions },
    annotate: (sessionId, customTitle) => annotated.push([sessionId, customTitle])
  })
  const renameTab = (customTitle: string | null): void => {
    tabs = { 'worktree-1': [{ id: 'tab-1', customTitle }] }
    for (const listener of listeners) {
      listener()
    }
  }
  return { annotated, renameTab }
}

describe('joinLiveSessionTitlesWithTabTitles', () => {
  it('names the row of the one running CLI session in a tab the user renames', () => {
    const ended = sampleLiveSession('local:claude:ended', {
      alive: false,
      surface: { kind: 'cli', paneKey: LEFT_PANE_KEY }
    })
    const { annotated, renameTab } = startJoin({ tabTitle: null, sessions: [ended, cliSession] })

    renameTab('Auth work')

    expect(annotated).toEqual([['local:claude:cli', 'Auth work']])
  })

  it('leaves the row alone when the tab was already named when first seen', () => {
    const { annotated } = startJoin({ tabTitle: 'Auth work', sessions: [cliSession] })

    expect(annotated).toEqual([])
  })

  it("clears the row's name when the tab's name is cleared", () => {
    const { annotated, renameTab } = startJoin({
      tabTitle: 'Auth work',
      sessions: [{ ...cliSession, customTitle: 'Auth work' }]
    })

    renameTab(null)

    expect(annotated).toEqual([['local:claude:cli', null]])
  })

  it('names no row when the tab is split between two CLI sessions', () => {
    const { annotated, renameTab } = startJoin({
      tabTitle: null,
      sessions: [
        cliSession,
        sampleLiveSession('local:codex:cli', { surface: { kind: 'cli', paneKey: RIGHT_PANE_KEY } })
      ]
    })

    renameTab('Auth work')

    expect(annotated).toEqual([])
  })

  it('does not rename a row back when the tab took its name from the row', () => {
    const { annotated, renameTab } = startJoin({
      tabTitle: null,
      sessions: [{ ...cliSession, customTitle: 'Auth work' }]
    })

    renameTab('Auth work')

    expect(annotated).toEqual([])
  })

  it('never names a chat or an external session after a terminal tab', () => {
    const { annotated, renameTab } = startJoin({
      tabTitle: null,
      sessions: [
        sampleLiveSession('local:claude:chat', {
          surface: { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-1' }
        }),
        sampleLiveSession('local:claude:external', { surface: { kind: 'external' } })
      ]
    })

    renameTab('Auth work')

    expect(annotated).toEqual([])
  })
})
