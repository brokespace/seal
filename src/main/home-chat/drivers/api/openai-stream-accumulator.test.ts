import { describe, expect, it } from 'vitest'
import { OpenAiStreamAccumulator } from './openai-stream-accumulator'

const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

describe('OpenAiStreamAccumulator', () => {
  it('assembles text, reasoning and split tool-call arguments across arbitrary chunk boundaries', () => {
    const stream = [
      sse({ choices: [{ delta: { reasoning: 'Need ' } }] }),
      sse({ choices: [{ delta: { reasoning_content: 'the list.' } }] }),
      sse({ choices: [{ delta: { content: 'Let me ' } }] }),
      sse({ choices: [{ delta: { content: 'check.' } }] }),
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_a',
                  function: { name: 'run_command', arguments: '{"machine":' }
                }
              ]
            }
          }
        ]
      }),
      sse({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"local","command":"ls"}' } }]
            }
          }
        ]
      }),
      sse({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 1, function: { name: 'list_machines', arguments: '{}' } }]
            }
          }
        ]
      }),
      sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]'
    ].join('')

    const acc = new OpenAiStreamAccumulator()
    const deltas = [stream.slice(0, 37), stream.slice(37, 200), stream.slice(200)].flatMap((c) =>
      acc.feed(c)
    )

    expect(deltas.filter((d) => d.kind === 'text').map((d) => d.text)).toEqual([
      'Let me ',
      'check.'
    ])
    expect(acc.result()).toEqual({
      content: 'Let me check.',
      reasoning: 'Need the list.',
      finishReason: 'tool_calls',
      toolCalls: [
        {
          id: 'call_a',
          type: 'function',
          function: { name: 'run_command', arguments: '{"machine":"local","command":"ls"}' }
        },
        { id: 'call_1', type: 'function', function: { name: 'list_machines', arguments: '{}' } }
      ],
      usage: null
    })
  })

  it('surfaces an in-stream provider error', () => {
    const acc = new OpenAiStreamAccumulator()
    expect(() => acc.feed(sse({ error: { message: 'Rate limit exceeded' } }))).toThrow(
      'Rate limit exceeded'
    )
  })
})
