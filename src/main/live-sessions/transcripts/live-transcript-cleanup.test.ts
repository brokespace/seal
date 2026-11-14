import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { completeLines, decodeTranscriptLines } from './live-transcript-reader'
import type { LiveSessionProvider } from '../../../shared/live-sessions/live-session-types'

function rows(provider: LiveSessionProvider, file: string): string[] {
  const bytes = readFileSync(join(__dirname, file))
  const { lines } = completeLines(bytes, 0, false)
  return decodeTranscriptLines(provider, lines).flatMap((message) =>
    message.blocks.flatMap((block) =>
      block.type === 'text'
        ? [`${message.role}: ${block.presentation ? `[${block.presentation}]` : block.text}`]
        : []
    )
  )
}

describe('live transcript cleanup on real recordings', () => {
  it('shows a Claude session that errored, resumed and compacted as one plain conversation', () => {
    expect(rows('claude', '__fixtures__/claude-2.1.325-error-resume-compact.jsonl')).toEqual([
      'user: What is the answer?',
      'assistant: <summary>The user asked for the answer; it is 42.</summary>',
      'user: Try again please',
      'assistant: API Error: 400 Simulated outage',
      'user: And now?',
      'assistant: Done. The answer is 42.',
      'system: [compaction]',
      'user: After compaction, what was it?',
      'assistant: <summary>The user asked for the answer; it is 42.</summary>'
    ])
  })

  it('folds the summary Seal hands a fresh session into a divider', () => {
    expect(rows('claude', '__fixtures__/claude-2.1.325-seal-home-chat-preamble.jsonl')).toEqual([
      'system: [compaction]',
      'user: What failed on the last deploy?',
      'assistant: <summary>The user asked for the answer; it is 42.</summary>'
    ])
  })

  it('shows a Codex prompt once, without the injected environment and instructions', () => {
    expect(rows('codex', '__fixtures__/codex-exec-auth-error.jsonl')).toEqual([
      'user: Reply with just the word hi'
    ])
  })

  it('keeps the visible turns of a recorded Codex 0.162 rollout once each', () => {
    const seen = rows('codex', '../../codex/__fixtures__/codex-rollout-a-0.162.1.jsonl')
    expect(seen.map((row) => row.slice(0, 30))).toEqual([
      'user: Importer QA A. These are',
      'assistant: I’ll run the comman',
      'system: Conversation interrupt'
    ])
  })
})
