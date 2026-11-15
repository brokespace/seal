import { describe, expect, it } from 'vitest'
import { agentVerdictDisplayMark } from '../../agent-status/lifecycle/agent-main-agent-verdict'
import { createHookListenerState } from '../listener-state'
import { normalizeAndAccept } from './agent-hook-listener-test-harness'

type Source = Parameters<typeof normalizeAndAccept>[1]

// Each agent's event for a turn that ended in an error, beside its ordinary end of turn.
// Hand-written in the shape each mapper reads; not captured from the agents.
const TURN_ENDS: {
  agent: Source
  ending: string
  hook: Record<string, unknown>
  marks: string | null
}[] = [
  {
    agent: 'kimi',
    ending: 'failed',
    hook: { hook_event_name: 'StopFailure', session_id: 'k-1', error: 'rate_limit' },
    marks: 'failed'
  },
  {
    agent: 'kimi',
    ending: 'finished',
    hook: { hook_event_name: 'Stop', session_id: 'k-1' },
    marks: null
  },
  {
    agent: 'copilot',
    ending: 'failed',
    hook: {
      hook_event_name: 'errorOccurred',
      sessionId: 'c-1',
      error: { name: 'ModelError', message: 'model request failed' },
      recoverable: false
    },
    marks: 'failed'
  },
  {
    agent: 'copilot',
    ending: 'finished',
    hook: { hook_event_name: 'agentStop', sessionId: 'c-1', stopReason: 'end_turn' },
    marks: null
  },
  {
    agent: 'jcode',
    ending: 'failed',
    hook: { event: 'turn_end', session_id: 'j-1', status: 'error', error: 'provider overloaded' },
    marks: 'failed'
  },
  {
    agent: 'jcode',
    ending: 'finished',
    hook: { event: 'turn_end', session_id: 'j-1', status: 'ok', last_assistant_text: 'Done.' },
    marks: null
  }
]

describe('how a turn ended, as an agent row records it', () => {
  it.each(TURN_ENDS)('a $agent turn that $ending', ({ agent, hook, marks }) => {
    const event = normalizeAndAccept(createHookListenerState(), agent, hook)
    expect(event?.payload.state).toBe('done')
    expect(event && agentVerdictDisplayMark(event.payload)).toBe(marks)
  })

  it('keeps a Copilot turn working through an error it can recover from', () => {
    const event = normalizeAndAccept(createHookListenerState(), 'copilot', {
      hook_event_name: 'errorOccurred',
      sessionId: 'c-1',
      error: { name: 'RateLimit', message: 'retrying' },
      recoverable: true
    })
    expect(event?.payload.state).toBe('working')
    expect(event && agentVerdictDisplayMark(event.payload)).toBe(null)
  })
})
