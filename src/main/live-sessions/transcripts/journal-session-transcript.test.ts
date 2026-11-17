import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import { journalSessionTranscript } from './journal-session-transcript'

function said(
  sequence: number,
  role: 'user' | 'assistant',
  text: string,
  overrides: Partial<AgentJournalRenderItem> = {}
): AgentJournalRenderItem {
  return {
    itemId: `item-${sequence}`,
    revision: 0,
    sequence,
    observedAt: sequence * 1_000,
    body: { kind: 'message', role, blocks: [{ type: 'text', text }] },
    ...overrides
  }
}

function journal(items: AgentJournalRenderItem[], sequence: number, working = false) {
  const state = { items, sequence, working }
  const transcript = journalSessionTranscript('local:opencode:abc', {
    snapshot: async () => ({
      cursor: { epoch: 'e1', sequence: state.sequence },
      items: state.items
    }),
    working: () => state.working
  })
  return { state, transcript }
}

const texts = (messages: { blocks: { type: string; text?: string }[] }[]) =>
  messages.map((message) => message.blocks.map((block) => block.text).join(''))

describe('journalSessionTranscript', () => {
  it("pages a chat's own conversation by journal sequence, leaving out its subagents", async () => {
    const { transcript } = journal(
      [
        said(1, 'user', 'Fix the login redirect'),
        said(2, 'assistant', 'Looking at the middleware.'),
        said(3, 'assistant', 'Subagent chatter', { agentId: 'sub-1' }),
        said(4, 'assistant', 'Patched it.')
      ],
      5
    )

    const newest = await transcript.page(null, 2)
    expect(texts(newest.messages)).toEqual(['Looking at the middleware.', 'Patched it.'])
    expect(newest.messages.map((message) => message.id)).toEqual(['item-2', 'item-4'])
    expect({ cursor: newest.cursor, start: newest.start, more: newest.more }).toEqual({
      cursor: 5,
      start: 2,
      more: true
    })

    const older = await transcript.page(newest.start, 2)
    expect(texts(older.messages)).toEqual(['Fix the login redirect'])
    // The conversation's first page starts at 0, which a recap reads as "nothing left out".
    expect({ start: older.start, more: older.more }).toEqual({ start: 0, more: false })
  })

  it('keeps the newest rows that fit one reply in a page, and pages back from the first of them', async () => {
    const megabyte = 'x'.repeat(1024 * 1024)
    const { transcript } = journal(
      [said(1, 'assistant', megabyte), said(2, 'assistant', megabyte), said(3, 'user', 'Thanks')],
      3
    )

    const newest = await transcript.page(null)
    expect(newest.messages.map((message) => message.id)).toEqual(['item-2', 'item-3'])
    expect({ cursor: newest.cursor, start: newest.start, more: newest.more }).toEqual({
      cursor: 3,
      start: 2,
      more: true
    })

    const older = await transcript.page(newest.start)
    expect(older.messages.map((message) => message.id)).toEqual(['item-1'])
    expect({ start: older.start, more: older.more }).toEqual({ start: 0, more: false })
  })

  it('holds back the reply a running turn is still writing until the turn ends', async () => {
    const { state, transcript } = journal(
      [said(1, 'user', 'Fix the login redirect'), said(2, 'assistant', 'Patch')],
      2,
      true
    )

    const during = await transcript.since(0)
    expect(texts(during.messages)).toEqual(['Fix the login redirect'])
    expect(during.cursor).toBe(1)

    state.items = [state.items[0], said(2, 'assistant', 'Patched the middleware.')]
    state.sequence = 6
    state.working = false
    const after = await transcript.since(during.cursor)
    expect(texts(after.messages)).toEqual(['Patched the middleware.'])
    expect(after).toMatchObject({ cursor: 6, shrank: false })
  })

  it('starts the conversation at the latest /clear, and tells a cursor from before it to start over', async () => {
    const { transcript } = journal(
      [
        said(1, 'user', 'Fix the login redirect'),
        said(2, 'assistant', 'Patched it.'),
        {
          itemId: 'item-3',
          revision: 0,
          sequence: 3,
          observedAt: 3_000,
          body: {
            kind: 'status',
            text: 'Context cleared',
            contextClear: { operationId: 'clear-1', afterFence: 2, clearedAt: 3_000 }
          }
        },
        said(4, 'user', 'Add a rate limiter'),
        said(5, 'assistant', 'Added one.')
      ],
      5
    )

    const page = await transcript.page(null)
    expect(page.messages.map((message) => message.id)).toEqual(['item-3', 'item-4', 'item-5'])
    expect({ start: page.start, more: page.more }).toEqual({ start: 0, more: false })
    expect(await transcript.since(2)).toEqual({ messages: [], cursor: 2, shrank: true })
    expect(texts((await transcript.since(4)).messages)).toEqual(['Added one.'])
  })

  it('says the journal was started over when the cursor is past its end', async () => {
    const { transcript } = journal([said(1, 'user', 'Hello')], 1)

    expect(await transcript.since(40)).toEqual({ messages: [], cursor: 40, shrank: true })
  })
})
