import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LiveSessionProvider } from '../../../shared/live-sessions/live-session-types'
import { completeLines, decodeTranscriptLines } from './live-transcript-reader'
import { UNRECORDED_REASONING_TEXT } from './live-transcript-reasoning'

const FIXTURES = join(__dirname, '..', 'discovery', '__fixtures__')

function decode(provider: LiveSessionProvider, fixture: string, subagent = false) {
  const bytes = readFileSync(join(FIXTURES, fixture))
  return decodeTranscriptLines(provider, completeLines(bytes, 0, false).lines, { subagent })
}

function textOf(message: ReturnType<typeof decode>[number]): string {
  return message.blocks.map((block) => (block.type === 'text' ? block.text : block.type)).join('|')
}

describe('reasoning in a live transcript', () => {
  it('shows Claude thinking text, and signature-only thinking with its duration', () => {
    const rows = decode('claude', 'claude-reasoning.jsonl').map((message) => [
      message.role,
      textOf(message),
      message.state,
      message.completedAt === undefined || message.timestamp === null
        ? null
        : message.completedAt - message.timestamp
    ])
    expect(rows).toEqual([
      ['user', 'Why is the nightly export slow?', undefined, null],
      [
        'reasoning',
        'The export joins orders to line_items without an index on line_items.order_id, so each batch scans the table.',
        'completed',
        null
      ],
      [
        'assistant',
        'The export scans line_items for every batch. I will check the query plan.',
        undefined,
        null
      ],
      ['reasoning', UNRECORDED_REASONING_TEXT, 'completed', 3400],
      ['assistant', 'tool-call', undefined, null]
    ])
  })

  it('shows a Codex reasoning summary once', () => {
    const reasoning = decode('codex', 'codex-working.jsonl').filter((m) => m.role === 'reasoning')
    expect(reasoning.map(textOf)).toEqual([
      '**Tracing the handlers**\n\nThe handlers share a router factory, so one middleware covers them all.'
    ])
    expect(reasoning[0].state).toBe('completed')
  })
})

describe("a subagent's own transcript", () => {
  const fixture = 'claude-waiting-foreground-subagent.subagents/agent-a3f81c0e5b7d29416.jsonl'

  it('is hidden from its session and read whole in its own view', () => {
    expect(decode('claude', fixture)).toEqual([])
    expect(decode('claude', fixture, true).map((m) => [m.role, textOf(m)])).toEqual([
      [
        'user',
        'Read every file under src/payments and list each promise that can reject without a handler. Report file, line and a one-line fix.'
      ],
      ['assistant', 'tool-call'],
      ['tool', 'tool-result'],
      ['assistant', 'tool-call']
    ])
  })
})
