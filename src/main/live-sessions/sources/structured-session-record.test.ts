import { describe, expect, it } from 'vitest'
import type { AgentSessionProviderHandleLink } from '../../../shared/agent-session/lifecycle/agent-session-provider-handle'
import { structuredLiveSession, type StructuredSessionFacts } from './structured-session-record'
import type { StructuredSessionRequest } from './structured-session-prompts'

const LOCAL = { hostId: 'local', label: 'desk', kind: 'local' } as const

function link(nativeId: string): AgentSessionProviderHandleLink {
  return {
    linkId: `link-${nativeId}`,
    handle: { transport: 'claude-sdk', agent: 'claude', nativeId },
    origin: 'resumed',
    mintedAtFence: 1,
    observedAt: 1_000
  }
}

function facts(patch: Partial<StructuredSessionFacts> = {}): StructuredSessionFacts {
  return {
    record: { sessionId: 'chat-1', provider: 'claude', providerHandleChain: [], createdAt: 1_000 },
    forkedFrom: null,
    machine: LOCAL,
    summary: { status: 'idle', latestPrompt: 'Fix checkout', updatedAt: 2_000 },
    requests: [],
    toolInFlight: null,
    todos: [],
    tab: { id: 'tab-1', visible: true },
    takesInput: true,
    cwd: '/srv/shop',
    configDir: null,
    pid: null,
    context: null,
    ...patch
  }
}

const APPROVAL: StructuredSessionRequest = {
  itemId: 'item-7',
  revision: 2,
  kind: 'approval',
  question: 'Allow Bash? pnpm test',
  options: [
    { id: 'allow', label: 'Allow' },
    { id: 'deny', label: 'Deny' }
  ]
}
const QUESTION: StructuredSessionRequest = {
  itemId: 'item-9',
  revision: 0,
  kind: 'question',
  question: 'Which database?',
  options: [{ id: 'pg', label: 'Postgres' }]
}
const RUNNING: StructuredSessionFacts['summary'] = {
  status: 'working',
  latestPrompt: 'Fix checkout',
  updatedAt: 2_000,
  hostExecutionOwned: true
}
/** The agent process has gone; the turn it ended stays on record. */
const RESTING: StructuredSessionFacts['summary'] = {
  status: 'idle',
  latestPrompt: 'Fix checkout',
  updatedAt: 2_000,
  turnOutcome: 'success'
}
const SETTLED: StructuredSessionFacts['summary'] = { ...RESTING, hostExecutionOwned: true }

describe('a chat as the registry lists it', () => {
  it.each<[string, Partial<StructuredSessionFacts>, string, string | null]>([
    [
      'a pending approval item',
      { summary: { ...RUNNING, status: 'attention' }, requests: [APPROVAL] },
      'needs-permission',
      'Allow Bash? pnpm test'
    ],
    [
      'a pending question item',
      { summary: { ...RUNNING, status: 'attention' }, requests: [QUESTION] },
      'waiting-input',
      'Question for you'
    ],
    [
      'the host waiting on the user with no item read yet',
      { summary: { ...RUNNING, status: 'attention' } },
      'waiting-input',
      'Question for you'
    ],
    [
      'an approval beside a question',
      { summary: { ...RUNNING, status: 'attention' }, requests: [QUESTION, APPROVAL] },
      'needs-permission',
      'Allow Bash? pnpm test'
    ],
    ['a failed last turn', { summary: { ...SETTLED, turnOutcome: 'failure' } }, 'errored', null],
    [
      'an agent that died in its turn',
      { summary: { ...SETTLED, turnOutcome: 'interruption' } },
      'errored',
      null
    ],
    [
      'a running turn inside a shell tool',
      { summary: { ...RUNNING, toolName: 'Bash' }, toolInFlight: { name: 'Bash' } },
      'running-shell',
      null
    ],
    [
      'a running turn inside another tool',
      { summary: { ...RUNNING, toolName: 'Read' }, toolInFlight: { name: 'Read' } },
      'working',
      'Read'
    ],
    [
      'a running turn whose shell tool has finished',
      { summary: { ...RUNNING, toolName: 'Bash' } },
      'working',
      'Bash'
    ],
    [
      'a turn waiting on a subagent',
      { summary: { ...RUNNING, backgroundTasks: [{ id: 'a1', kind: 'agent' }] } },
      'waiting-subagent',
      null
    ],
    [
      'an ended turn with a subagent still running',
      { summary: { ...SETTLED, backgroundTasks: [{ id: 'a1', kind: 'agent' }] } },
      'waiting-subagent',
      null
    ],
    [
      'an ended turn with a background task still running',
      { summary: { ...SETTLED, backgroundTasks: [{ id: 't1', kind: 'command' }] } },
      'waiting-task',
      null
    ],
    [
      'an ended turn whose background task has finished',
      { summary: { ...SETTLED, backgroundTasks: [{ id: 't1', kind: 'command', state: 'done' }] } },
      'your-turn',
      null
    ],
    ['an ended turn with nothing running', { summary: SETTLED }, 'your-turn', null],
    [
      'a turn the user stopped',
      { summary: { ...SETTLED, turnOutcome: 'cancellation' } },
      'your-turn',
      'Interrupted'
    ],
    [
      'an ended turn whose agent was put to rest with the tab open',
      { summary: RESTING },
      'your-turn',
      null
    ],
    [
      'a chat with no turn yet',
      { summary: { status: null, latestPrompt: '', updatedAt: 1_000 } },
      'idle',
      null
    ],
    [
      'a closed chat',
      {
        summary: RESTING,
        tab: { id: 'tab-1', visible: false }
      },
      'done',
      null
    ],
    ['a chat this host can no longer run', { summary: RESTING, takesInput: false }, 'done', null],
    [
      'a chat put to sleep',
      {
        summary: RESTING,
        record: { ...facts().record, sleptAt: 3_000 }
      },
      'done',
      null
    ],
    [
      'a closed chat whose last turn failed',
      {
        summary: { ...RESTING, turnOutcome: 'failure' },
        tab: { id: 'tab-1', visible: false }
      },
      'errored',
      null
    ],
    [
      'a closed chat whose agent still works',
      { summary: RUNNING, tab: { id: 'tab-1', visible: false } },
      'working',
      null
    ]
  ])('reads %s', (_evidence, patch, status, statusDetail) => {
    const session = structuredLiveSession(facts(patch))

    expect(session?.status).toBe(status)
    expect(session?.statusDetail).toBe(statusDetail)
  })

  it.each<[string, Partial<StructuredSessionFacts>, string, string, string[] | undefined]>([
    ['a chat its provider has not named', {}, 'local:claude:seal-chat-1', 'seal-chat-1', undefined],
    [
      'a chat with a provider handle',
      { record: { ...facts().record, providerHandleChain: [link('abc')] } },
      'local:claude:abc',
      'abc',
      undefined
    ],
    [
      'a chat resumed into a new provider session',
      { record: { ...facts().record, providerHandleChain: [link('abc'), link('def')] } },
      'local:claude:def',
      'def',
      ['local:claude:abc']
    ],
    [
      'a fork of a named chat',
      {
        record: { ...facts().record, providerHandleChain: [link('def')] },
        forkedFrom: { sessionId: 'chat-0', provider: 'claude', providerHandleChain: [link('abc')] }
      },
      'local:claude:def',
      'def',
      ['local:claude:abc']
    ],
    [
      'a fork of a chat its provider has not named',
      { forkedFrom: { sessionId: 'chat-0', provider: 'claude', providerHandleChain: [] } },
      'local:claude:seal-chat-1',
      'seal-chat-1',
      ['local:claude:seal-chat-0']
    ]
  ])('names %s', (_chat, patch, id, providerSessionId, continues) => {
    const session = structuredLiveSession(facts(patch))

    expect(session?.id).toBe(id)
    expect(session?.providerSessionId).toBe(providerSessionId)
    expect(session?.continues).toEqual(continues)
    // The registry follows a rename by the chat's own id, which never changes.
    expect(session?.surface).toEqual({ kind: 'chat', sessionId: 'chat-1', tabId: 'tab-1' })
  })

  it.each<[string, Partial<StructuredSessionFacts>, unknown[]]>([
    ['a chat that takes a message', {}, [{ kind: 'structured', sessionId: 'chat-1' }]],
    ['a chat that cannot be resumed', { takesInput: false }, []]
  ])('routes input to %s through its host only', (_chat, patch, inputRoutes) => {
    const session = structuredLiveSession(facts(patch))

    expect(session?.inputRoutes).toEqual(inputRoutes)
    expect(session?.surface.kind).toBe('chat')
  })
})
