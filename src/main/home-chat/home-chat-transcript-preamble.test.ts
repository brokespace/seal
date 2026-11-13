import { describe, expect, it } from 'vitest'
import { withTranscriptPreamble } from './home-chat-transcript-preamble'
import type { HomeChatEntry } from '../../shared/home-chat/home-chat-types'

describe('withTranscriptPreamble', () => {
  it('carries earlier turns into a fresh session and leaves a first message alone', () => {
    const entries: HomeChatEntry[] = [
      {
        id: '1',
        rev: 1,
        at: 1,
        kind: 'user',
        text: 'Where is the seal repo?',
        delivery: 'delivered'
      },
      {
        id: '2',
        rev: 3,
        at: 2,
        kind: 'tool',
        tool: 'run_command',
        input: {},
        machine: 'gpu-box',
        status: 'ok'
      },
      { id: '3', rev: 2, at: 3, kind: 'thinking', text: 'hmm', streaming: false },
      {
        id: '4',
        rev: 2,
        at: 4,
        kind: 'assistant',
        text: 'In ~/code/seal on gpu-box.',
        streaming: false
      }
    ]

    expect(withTranscriptPreamble(entries, 'Run its tests')).toBe(
      '<earlier_conversation>\nUser: Where is the seal repo?\n(tool run_command ok on gpu-box)\nAssistant: In ~/code/seal on gpu-box.\n</earlier_conversation>\n\nRun its tests'
    )
    expect(withTranscriptPreamble([], 'Hello')).toBe('Hello')
  })
})
