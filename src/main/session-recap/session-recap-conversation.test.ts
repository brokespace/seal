import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../shared/native-chat/native-chat-types'
import {
  completeLines,
  decodeTranscriptLines
} from '../live-sessions/transcripts/live-transcript-reader'
import { recapConversationSince } from './session-recap-conversation'

/** A recording as the live session reader hands it to the recap. */
function recorded(provider: 'claude' | 'codex', path: string): NativeChatMessage[] {
  const bytes = readFileSync(join(__dirname, '..', path))
  return decodeTranscriptLines(provider, completeLines(bytes, 0, false).lines)
}

function conversation(messages: NativeChatMessage[]) {
  const first = messages.find((message) => message.role === 'user')
  return recapConversationSince(messages, first?.id ?? '', (command) => command)
}

describe('recapConversationSince', () => {
  it('reads the edits and the command inside Codex code-mode cells', () => {
    const file =
      '/Users/brennanbenson/orca/workspaces/orca/qa-codex-exec-import-qg/codex-exec-import/run/workspace/codex-exec-import-sample.txt'
    expect(
      conversation(recorded('codex', 'codex/__fixtures__/codex-rollout-c-0.162.1.jsonl'))?.lines
    ).toEqual([
      'USER: Importer QA C. Use the actual apply_patch tool once, not a shell patch command, to add codex-exec-import-sample.txt containing exactly before followed by a newline. Use apply_patch once more to change that one line to after. Read that file once with the normal shell read command. Do not touch another file or read configs/credentials/network. Finish with only patch-ready.',
      'AGENT: I\u2019ll apply the two patches, then read the file once.',
      `AGENT edited ${file}`,
      `AGENT edited ${file}`,
      'AGENT ran: cat codex-exec-import-sample.txt',
      'AGENT: patch-ready'
    ])
  })

  it('reads what a background subagent reported, and knows nothing more is to come', () => {
    const messages = recorded(
      'claude',
      'live-sessions/discovery/__fixtures__/live-claude-background-agent.jsonl'
    )
    expect(conversation(messages)).toEqual({
      lines: [
        'USER: Audit the logs in the background',
        'AGENT started a subagent: Audit logs',
        'AGENT: I started the audit in the background and will report when it is back.',
        'SUBAGENT reported: Audit done: no errors found.',
        'AGENT: The audit came back clean.'
      ],
      userTurns: 0,
      endsOnUser: false,
      complete: true
    })
    // Before the report lands, the judge has not seen the work: the request stays open.
    expect(conversation(messages.slice(0, 4))?.complete).toBe(false)
  })

  it('leaves out user rows that ask the agent for nothing', () => {
    const row = (id: string, role: 'user' | 'assistant', text: string): NativeChatMessage => ({
      id,
      role,
      blocks: [{ type: 'text', text }],
      timestamp: null,
      source: 'transcript'
    })
    expect(
      conversation([
        row('1', 'user', 'Fix the build'),
        row('2', 'assistant', 'Working on it.'),
        row('3', 'user', '[Request interrupted by user for tool use]'),
        row('4', 'user', '!git status'),
        row('5', 'user', '[Image #1]'),
        row('6', 'user', '[Image: source: /tmp/shot.png]')
      ])
    ).toEqual({
      lines: ['USER: Fix the build', 'AGENT: Working on it.'],
      userTurns: 0,
      endsOnUser: false,
      complete: true
    })
  })
})
