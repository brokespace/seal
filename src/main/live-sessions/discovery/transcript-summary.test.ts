import { describe, expect, it } from 'vitest'
import { summarizeClaudeTranscript, summarizeCodexRollout } from './transcript-summary'

const lines = (records: unknown[]) => `${records.map((r) => JSON.stringify(r)).join('\n')}\n`
const at = (s: number) => `2026-11-13T10:00:${String(s).padStart(2, '0')}.000Z`

const claudePath =
  '/home/b/.claude/projects/-home-b-seal/0b5f0c7e-1111-4222-8333-944445555666.jsonl'

describe('summarizeClaudeTranscript', () => {
  const opening = [
    {
      type: 'user',
      cwd: '/home/b/seal',
      timestamp: at(0),
      message: { role: 'user', content: 'Fix the flaky sidebar test' }
    },
    {
      type: 'assistant',
      cwd: '/home/b/seal',
      timestamp: at(5),
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test sidebar' } }
        ]
      }
    }
  ]

  it('names the session after its first prompt and sees a running tool', () => {
    const text = lines(opening)
    expect(
      summarizeClaudeTranscript({ path: claudePath, head: text, tail: text, tailIsWholeFile: true })
    ).toMatchObject({
      provider: 'claude',
      providerSessionId: '0b5f0c7e-1111-4222-8333-944445555666',
      cwd: '/home/b/seal',
      title: 'Fix the flaky sidebar test',
      phase: 'tool-pending',
      detail: 'Bash: pnpm test sidebar',
      firstAt: Date.parse(at(0)),
      lastAt: Date.parse(at(5))
    })
  })

  it('sees the turn end, a rename, and API errors', () => {
    const ended = lines([
      ...opening,
      {
        type: 'user',
        timestamp: at(9),
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]
        }
      },
      {
        type: 'assistant',
        timestamp: at(12),
        message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed.' }] }
      },
      { type: 'custom-title', customTitle: 'Sidebar flake' }
    ])
    const summary = summarizeClaudeTranscript({
      path: claudePath,
      head: ended,
      tail: ended,
      tailIsWholeFile: true
    })
    expect(summary.phase).toBe('turn-ended')
    expect(summary.title).toBe('Sidebar flake')

    const errored = lines([
      ...opening,
      {
        type: 'assistant',
        timestamp: at(20),
        isApiErrorMessage: true,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'API Error: 529 overloaded' }]
        }
      }
    ])
    expect(
      summarizeClaudeTranscript({
        path: claudePath,
        head: errored,
        tail: errored,
        tailIsWholeFile: true
      })
    ).toMatchObject({
      phase: 'errored',
      detail: 'API Error: 529 overloaded'
    })
  })

  it('skips the cut-off first line of a partial tail', () => {
    const tail = `"cut":"off"}\n${lines([
      { type: 'user', timestamp: at(30), message: { role: 'user', content: 'go on' } }
    ])}`
    expect(
      summarizeClaudeTranscript({ path: claudePath, head: null, tail, tailIsWholeFile: false })
        .phase
    ).toBe('working')
  })
})

describe('summarizeCodexRollout', () => {
  const path =
    '/home/b/.codex/sessions/2026/11/13/rollout-2026-11-13T10-00-00-0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.jsonl'
  const meta = {
    type: 'session_meta',
    timestamp: at(0),
    payload: { id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', cwd: '/srv/api' }
  }

  it('reads id, cwd, prompt and an approval request', () => {
    const text = lines([
      meta,
      {
        type: 'event_msg',
        timestamp: at(1),
        payload: { type: 'user_message', message: '<environment_context>…' }
      },
      {
        type: 'event_msg',
        timestamp: at(2),
        payload: { type: 'user_message', message: 'Add rate limiting' }
      },
      { type: 'event_msg', timestamp: at(3), payload: { type: 'task_started' } },
      {
        type: 'event_msg',
        timestamp: at(4),
        payload: { type: 'exec_approval_request', command: ['rm', '-rf', 'tmp'] }
      }
    ])
    expect(
      summarizeCodexRollout({ path, head: text, tail: text, tailIsWholeFile: true })
    ).toMatchObject({
      provider: 'codex',
      providerSessionId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      cwd: '/srv/api',
      title: 'Add rate limiting',
      phase: 'approval-requested',
      detail: 'Allow rm -rf tmp?',
      firstAt: Date.parse(at(0)),
      lastAt: Date.parse(at(4))
    })
  })

  it('sees a completed task as ended', () => {
    const text = lines([
      meta,
      { type: 'event_msg', timestamp: at(5), payload: { type: 'task_complete' } }
    ])
    expect(
      summarizeCodexRollout({ path, head: text, tail: text, tailIsWholeFile: true }).phase
    ).toBe('turn-ended')
  })
})
