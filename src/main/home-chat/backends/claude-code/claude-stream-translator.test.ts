import { describe, expect, it } from 'vitest'
import { HomeChatEntryWriter } from '../../home-chat-entry-writer'
import { mergeHomeChatEntry } from '../../../../shared/home-chat/home-chat-entry-merge'
import type { HomeChatEntry } from '../../../../shared/home-chat/home-chat-types'
import { ClaudeStreamTranslator } from './claude-stream-translator'

function setup(): { translator: ClaudeStreamTranslator; entries: () => HomeChatEntry[] } {
  let entries: HomeChatEntry[] = []
  const writer = new HomeChatEntryWriter((entry) => {
    entries = mergeHomeChatEntry(entries, entry)
  })
  return { translator: new ClaudeStreamTranslator(writer), entries: () => entries }
}

const event = (e: Record<string, unknown>): Record<string, unknown> => ({
  type: 'stream_event',
  event: e,
  parent_tool_use_id: null,
  session_id: 's1'
})

describe('ClaudeStreamTranslator', () => {
  it('streams text, skips the duplicate final message, and renders built-in tools', () => {
    const { translator, entries } = setup()
    translator.handle(event({ type: 'message_start', message: { id: 'm1' } }))
    translator.handle(
      event({ type: 'content_block_start', index: 0, content_block: { type: 'text' } })
    )
    translator.handle(
      event({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Checking ' }
      })
    )
    translator.handle(
      event({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'gpu-box.' }
      })
    )
    translator.handle(event({ type: 'content_block_stop', index: 0 }))
    translator.handle({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        id: 'm1',
        content: [
          { type: 'text', text: 'Checking gpu-box.' },
          { type: 'tool_use', id: 't1', name: 'mcp__seal__run_command', input: { command: 'ls' } },
          { type: 'tool_use', id: 't2', name: 'WebFetch', input: { url: 'https://example.com' } }
        ]
      }
    })
    translator.handle({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'page' }] }
        ]
      }
    })
    const done = translator.handle({
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: 's1'
    })

    expect(done).toEqual({ sessionId: 's1', turnDone: true })
    expect(entries().map(({ id: _id, at: _at, rev: _rev, ...rest }) => rest)).toEqual([
      { kind: 'assistant', text: 'Checking gpu-box.', streaming: false },
      {
        kind: 'tool',
        tool: 'WebFetch',
        input: { url: 'https://example.com' },
        status: 'ok',
        output: 'page'
      }
    ])
  })

  it('reports a failed result as the turn error', () => {
    const { translator } = setup()
    expect(
      translator.handle({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['Not logged in']
      })
    ).toEqual({ sessionId: undefined, turnDone: true, error: 'Not logged in' })
  })
})
