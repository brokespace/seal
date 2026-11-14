import { describe, expect, it } from 'vitest'
import type { HomeChatConversationItem } from '../../thread/home-chat-thread-history'
import { encodeOpenAiMessages } from './openai-wire-messages'

const at = 1
const call = (callId: string): HomeChatConversationItem => ({
  type: 'assistant',
  seq: 2,
  id: 'a1',
  at,
  stop: 'tool_calls',
  parts: [
    { id: 'p1', ord: 2, kind: 'thinking', text: 'private reasoning' },
    { id: 'p2', ord: 3, kind: 'text', text: 'Checking.' },
    {
      id: 'p3',
      ord: 4,
      kind: 'tool_call',
      callId,
      tool: 'run_command',
      input: { machine: 'kessel-ml' }
    }
  ]
})

describe('encodeOpenAiMessages', () => {
  it('replays a tool round as tool_calls followed by its tool answer', () => {
    const items: HomeChatConversationItem[] = [
      { type: 'user', seq: 1, id: 'u1', at, ord: 1, text: 'check kessel-ml', origin: 'user' },
      call('call_9'),
      {
        type: 'tool_result',
        seq: 3,
        id: 'r1',
        at,
        callId: 'call_9',
        tool: 'run_command',
        content: 'exit code 0',
        outcome: 'ok'
      }
    ]
    expect(encodeOpenAiMessages('SYSTEM', items)).toEqual([
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'check kessel-ml' },
      {
        role: 'assistant',
        content: 'Checking.',
        tool_calls: [
          {
            id: 'call_9',
            type: 'function',
            function: { name: 'run_command', arguments: '{"machine":"kessel-ml"}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'call_9', content: 'exit code 0' }
    ])
  })

  it('answers a call the turn never finished and drops a result without its call', () => {
    const items: HomeChatConversationItem[] = [
      call('call_cut'),
      {
        type: 'tool_result',
        seq: 3,
        id: 'r0',
        at,
        callId: 'call_gone',
        tool: 'read_file',
        content: 'orphan',
        outcome: 'ok'
      },
      { type: 'user', seq: 4, id: 'u2', at, ord: 5, text: 'still there?', origin: 'user' }
    ]
    expect(encodeOpenAiMessages('S', items).slice(2)).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call_cut',
        content: 'No result was recorded for this call: the turn ended before it answered.'
      },
      { role: 'user', content: 'still there?' }
    ])
  })
})
