// @vitest-environment happy-dom

import { expect, it } from 'vitest'
import { SAMPLE_NOW, sampleLiveSession } from '../live-session.test-fixture'
import { liveSessionPaletteResults, openSessionTabKeys } from './live-session-palette-source'

it("leaves a session whose tab is open to that tab's own palette row", () => {
  const sessions = [
    sampleLiveSession('chat', { surface: { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-a' } }),
    sampleLiveSession('pane', { surface: { kind: 'cli', paneKey: 'term-1:pane-2' } }),
    sampleLiveSession('closed-pane', { surface: { kind: 'cli', paneKey: 'term-9:pane-1' } }),
    sampleLiveSession('outside'),
    sampleLiveSession('outside-open')
  ]
  const openTabs = openSessionTabKeys({
    'repo-1::/a': [
      { contentType: 'agent-session', entityId: 'chat-1' },
      { contentType: 'terminal', entityId: 'term-1' },
      { contentType: 'external-agent-session', entityId: 'outside-open' },
      // A file that happens to share the closed pane's tab id is not that pane's tab.
      { contentType: 'editor', entityId: 'term-9' }
    ]
  })
  const listed = liveSessionPaletteResults(sessions, '', SAMPLE_NOW, openTabs, () => {})
  expect(listed.map((result) => result.id).sort()).toEqual([
    'live-session:closed-pane',
    'live-session:outside'
  ])
})
