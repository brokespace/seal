import { defineFixture } from '../../component-fixtures/component-fixture'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import type { LiveMessage, LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { LiveSessionsView } from './LiveSessionsPage'
import { LiveSessionChat } from './LiveSessionChat'
import { pendingRows } from './live-session-pending-rows'

const NOW = 1_800_000_000_000
const local = { hostId: 'local', label: 'brian-mbp', kind: 'local' } as const
const box = { hostId: 'ssh-build', label: 'build-box', kind: 'remote' } as const

function session(overrides: Partial<LiveSession> & Pick<LiveSession, 'id'>): LiveSession {
  return {
    provider: 'claude',
    providerSessionId: overrides.id,
    machine: local,
    origin: 'external',
    cwd: '/Users/brian/code/seal',
    project: 'seal',
    title: null,
    status: 'waiting-input',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: NOW - 60_000,
    startedAt: NOW - 3_600_000,
    alive: true,
    pid: 4242,
    transcriptPath: '/Users/brian/.claude/projects/-Users-brian-code-seal/x.jsonl',
    inputRoutes: [{ kind: 'tmux', target: '%3' }],
    permission: null,
    ...overrides
  }
}

const sessions: LiveSession[] = [
  session({
    id: 'a',
    title: 'Fix the flaky sidebar test',
    status: 'working',
    lastActivityAt: NOW - 5_000
  }),
  session({
    id: 'b',
    title: 'Migrate settings storage',
    status: 'needs-permission',
    origin: 'seal',
    lastActivityAt: NOW - 120_000,
    permission: {
      promptId: 'p1',
      question: 'Do you want to proceed?',
      options: [
        { id: '1', label: 'Yes' },
        { id: '2', label: 'Yes, and don’t ask again for rm commands' },
        { id: '3', label: 'No, and tell Claude what to do differently' }
      ]
    }
  }),
  session({
    id: 'c',
    title: 'Release notes draft',
    status: 'done',
    alive: false,
    lastActivityAt: NOW - 7_200_000,
    inputRoutes: [{ kind: 'resume' }]
  }),
  session({
    id: 'd',
    provider: 'codex',
    machine: box,
    cwd: '/srv/api',
    project: 'api',
    title: 'Add rate limiting to the upload endpoint',
    status: 'waiting-input',
    lastActivityAt: NOW - 900_000
  }),
  session({
    id: 'e',
    provider: 'codex',
    machine: box,
    cwd: '/srv/worker',
    project: 'worker',
    title: 'Queue retries',
    status: 'errored',
    lastActivityAt: NOW - 3_000_000
  })
]

let offset = 0
function row(role: NativeChatMessage['role'], text: string): NativeChatMessage {
  offset += 200
  return {
    id: `o${offset}`,
    role,
    source: 'transcript',
    timestamp: NOW - 600_000 + offset,
    transcriptOffset: offset,
    blocks: [{ type: 'text', text }]
  }
}

const transcript: NativeChatMessage[] = [
  row('user', 'The sidebar test fails about one run in five. Find out why.'),
  row(
    'assistant',
    'The test reads the worktree list before the store finishes hydrating. It passes when hydration wins the race.'
  ),
  {
    id: 'o5000',
    role: 'assistant',
    source: 'transcript',
    timestamp: NOW - 120_000,
    transcriptOffset: 5000,
    blocks: [
      {
        type: 'tool-call',
        name: 'Bash',
        state: 'completed',
        input: { command: 'pnpm test sidebar --repeat 20' }
      },
      { type: 'tool-result', output: '20 passed' }
    ]
  },
  row('assistant', 'Waiting on hydration in the test setup fixes it: 20 runs in a row pass.')
]

const message = (
  id: string,
  text: string,
  state: LiveMessage['state'],
  error: string | null = null
): LiveMessage => ({
  messageId: id,
  sessionId: 'a',
  text,
  state,
  route: 'tmux',
  error,
  createdAt: NOW - 10_000,
  updatedAt: NOW - 5_000
})

const pending = pendingRows(transcript, [
  message('m1', 'Great. Also run the whole sidebar suite.', 'sent'),
  message(
    'm2',
    'And open a PR when it passes.',
    'failed',
    'The session closed before it read the message'
  )
])

const chatTranscript = {
  phase: 'ready' as const,
  error: null,
  messages: transcript,
  hasMore: false,
  loadingEarlier: false,
  loadEarlier: async () => 'exhausted' as const
}

const noop = () => {}

export const chat = defineFixture({
  width: 1100,
  render: () => (
    <div className="flex h-[640px]">
      <LiveSessionsView
        loaded
        sessions={sessions}
        hostErrors={{}}
        selectedId="a"
        onSelect={noop}
        onRefresh={noop}
        now={NOW}
        chat={
          <LiveSessionChat
            session={sessions[0]}
            transcript={chatTranscript}
            pending={pending}
            onSend={noop}
            onRetry={noop}
            onAnswer={noop}
            answering={null}
          />
        }
      />
    </div>
  )
})

export const permission = defineFixture({
  width: 1100,
  render: () => (
    <div className="flex h-[640px]">
      <LiveSessionsView
        loaded
        sessions={sessions}
        hostErrors={{ 'ssh-old': 'staging: Permission denied (publickey)' }}
        selectedId="b"
        onSelect={noop}
        onRefresh={noop}
        now={NOW}
        chat={
          <LiveSessionChat
            session={sessions[1]}
            transcript={{ ...chatTranscript, messages: transcript.slice(0, 2) }}
            pending={[]}
            onSend={noop}
            onRetry={noop}
            onAnswer={noop}
            answering={null}
          />
        }
      />
    </div>
  )
})

const unreachable = session({
  id: '9d1c2f5e-7a1b-4c3d-9e8f-0a1b2c3d4e5f',
  title: 'Review the release checklist',
  machine: box,
  cwd: '/home/brian/code/seal',
  inputRoutes: []
})

function unreachableChat() {
  return (
    <div className="flex h-[640px]">
      <LiveSessionsView
        loaded
        sessions={[unreachable, ...sessions]}
        hostErrors={{}}
        selectedId={unreachable.id}
        onSelect={noop}
        onRefresh={noop}
        now={NOW}
        chat={
          <LiveSessionChat
            session={unreachable}
            transcript={{ ...chatTranscript, messages: transcript.slice(0, 2) }}
            pending={[]}
            onSend={noop}
            onRetry={noop}
            onAnswer={noop}
            answering={null}
          />
        }
      />
    </div>
  )
}

export const noRoute = defineFixture({ width: 1100, render: unreachableChat })

export const takeOver = defineFixture({
  width: 1100,
  render: unreachableChat,
  interact: (frame) =>
    [...frame.querySelectorAll<HTMLButtonElement>('header button')]
      .find((button) => button.textContent === 'Take over')
      ?.click()
})

const server = {
  hostId: 'runtime:kessel',
  label: 'kessel-ml',
  kind: 'remote',
  executionHostId: 'runtime:kessel',
  connection: 'server'
} as const
const serverSessions: LiveSession[] = [
  ...sessions.slice(0, 2),
  session({
    id: 'k1',
    machine: server,
    cwd: '/home/brian/ml/train',
    project: 'train',
    title: 'Sweep learning rates on the sonnet eval',
    status: 'working',
    startedAt: NOW - 3 * 86_400_000,
    lastActivityAt: NOW - 20_000,
    inputRoutes: [{ kind: 'tmux', target: '%0' }]
  }),
  session({
    id: 'k2',
    machine: server,
    cwd: '/home/brian/ml/data',
    project: 'data',
    title: 'Dedupe the crawl shards',
    status: 'waiting-input',
    startedAt: NOW - 3 * 86_400_000,
    lastActivityAt: NOW - 2 * 86_400_000,
    inputRoutes: [{ kind: 'tmux', target: '%36' }]
  })
]

export const pairedServers = defineFixture({
  width: 1100,
  render: () => (
    <div className="flex h-[640px]">
      <LiveSessionsView
        loaded
        sessions={serverSessions}
        hostErrors={{
          'runtime:old':
            'gpu-box runs an older Seal: update Seal on this server to see and message its agent sessions'
        }}
        selectedId="k1"
        onSelect={noop}
        onRefresh={noop}
        now={NOW}
        chat={
          <LiveSessionChat
            session={serverSessions[2]}
            transcript={chatTranscript}
            pending={[]}
            onSend={noop}
            onRetry={noop}
            onAnswer={noop}
            answering={null}
          />
        }
      />
    </div>
  )
})
