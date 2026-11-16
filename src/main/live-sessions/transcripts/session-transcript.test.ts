import { describe, expect, it } from 'vitest'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../../shared/agent-session/view/structured-agent-session-projection'
import type {
  LiveSession,
  LiveSessionInputRoute
} from '../../../shared/live-sessions/live-session-types'
import {
  hasSessionTranscript,
  transcriptOf,
  type SessionTranscript,
  type SessionTranscriptSources
} from './session-transcript'

function session(overrides: Partial<LiveSession>): LiveSession {
  return {
    id: 'local:claude:abc',
    provider: 'claude',
    providerSessionId: 'abc',
    machine: { hostId: 'local', label: 'mac', kind: 'local', connection: 'local' },
    origin: 'seal',
    cwd: '/repo',
    project: 'repo',
    title: 'Fix login',
    status: 'your-turn',
    statusSource: 'seal-hooks',
    statusDetail: null,
    lastActivityAt: 1_000,
    startedAt: 500,
    alive: true,
    pid: 42,
    transcriptPath: null,
    inputRoutes: [],
    permission: null,
    ...overrides
  }
}

function sources(held: string[]) {
  const reads: string[] = []
  const reading = (from: string): SessionTranscript => ({
    page: async () => {
      reads.push(from)
      return { sessionId: from, messages: [], cursor: 0, start: 0, more: false }
    },
    since: async (cursor) => ({ messages: [], cursor, shrank: false })
  })
  const all: SessionTranscriptSources = {
    files: {
      page: (sessionId, before) => reading(`file ${sessionId}`).page(before),
      since: async (_sessionId, cursor) => ({ messages: [], cursor, shrank: false })
    },
    journal: (chat, recordId) =>
      held.includes(chat) ? reading(`journal ${chat} as ${recordId}`) : null
  }
  return { all, reads }
}

const chatPane = (chat: string): LiveSessionInputRoute => ({
  kind: 'seal-pane',
  paneKey: structuredAgentSessionPaneKey(structuredAgentSessionTabId(chat), chat)
})

describe('transcriptOf', () => {
  it('reads a chat from its journal and every other session from its transcript file', async () => {
    const { all, reads } = sources(['chat-1'])
    const byRoute = session({ inputRoutes: [chatPane('chat-1')] })
    const bySurface = session({
      id: 'local:opencode:xyz',
      surface: { kind: 'chat', sessionId: 'chat-1', tabId: structuredAgentSessionTabId('chat-1') }
    })
    const cli = session({ inputRoutes: [{ kind: 'seal-pane', paneKey: 'tab-1:leaf-1' }] })
    const elsewhere = session({ inputRoutes: [chatPane('chat-2')] })

    for (const each of [byRoute, bySurface, cli, elsewhere]) {
      await transcriptOf(each, all).page(null)
    }

    expect(reads).toEqual([
      'journal chat-1 as local:claude:abc',
      'journal chat-1 as local:opencode:xyz',
      'file local:claude:abc',
      'file local:claude:abc'
    ])
    expect(
      [byRoute, cli, session({ transcriptPath: '/t.jsonl' })].map((each) =>
        hasSessionTranscript(each, all)
      )
    ).toEqual([true, false, true])
  })
})
