import { defineFixture } from '../../component-fixtures/component-fixture'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { LiveSessionsView } from './LiveSessionsPage'
import { LiveSessionChat } from './LiveSessionChat'

// What discovery produced from the recorded Claude Code 2.1.325 transcripts in
// src/main/live-sessions/transcripts/__fixtures__: a turn that errored, `--continue`, then a fork.
const NOW = 1_794_608_070_000
const FIRST = 'e503cd0b-d59c-4221-a949-3c685cf99554'
const FORK = '7f01a62c-a158-4451-a43b-a2e253ed713e'
const HOME_CHAT = '41532093-df01-43f6-9790-bab8fff5a196'

function session(providerSessionId: string, overrides: Partial<LiveSession>): LiveSession {
  return {
    id: `local:claude:${providerSessionId}`,
    provider: 'claude',
    providerSessionId,
    machine: { hostId: 'local', label: 'brian-mbp', kind: 'local' },
    origin: 'external',
    cwd: '/Users/brian/code/proj2',
    project: 'proj2',
    title: 'Fix the failing build',
    status: 'waiting-input',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: 1_794_608_010_044,
    startedAt: 1_794_607_917_347,
    alive: false,
    pid: null,
    transcriptPath: `/Users/brian/.claude/projects/-Users-brian-code-proj2/${providerSessionId}.jsonl`,
    inputRoutes: [],
    permission: null,
    ...overrides
  }
}

const fork = session(FORK, {})
const before: LiveSession[] = [
  session(HOME_CHAT, {
    cwd: '/Users/brian/Library/Application Support/Seal/home-chat/workspace',
    project: 'workspace',
    title: null,
    lastActivityAt: 1_794_608_010_000,
    startedAt: 1_794_603_392_143
  }),
  fork,
  session(FIRST, { lastActivityAt: 1_794_607_963_510 })
]

function row(n: number, role: NativeChatMessage['role'], text: string): NativeChatMessage {
  return {
    id: `o${n}`,
    role,
    source: 'transcript',
    timestamp: 1_794_607_917_347 + n,
    transcriptOffset: n,
    blocks: [{ type: 'text', text }]
  }
}

const transcript = {
  phase: 'ready' as const,
  error: null,
  messages: [
    row(1, 'user', 'Fix the failing build'),
    row(2, 'assistant', 'API Error: 400 Simulated outage'),
    row(3, 'user', 'Try again'),
    row(4, 'assistant', 'The build passes now.'),
    row(5, 'user', 'And add a test'),
    row(6, 'assistant', 'Added a test for the build step.')
  ],
  hasMore: false,
  loadingEarlier: false,
  loadEarlier: async () => 'exhausted' as const
}

const noop = (): void => {}

function view(sessions: LiveSession[]) {
  return () => (
    <div className="flex h-[480px]">
      <LiveSessionsView
        loaded
        sessions={sessions}
        hostErrors={{}}
        selectedId={fork.id}
        onSelect={noop}
        onRefresh={noop}
        now={NOW}
        chat={
          <LiveSessionChat
            session={fork}
            transcript={transcript}
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

export const resumeChainBefore = defineFixture({ width: 1100, render: view(before) })
export const resumeChainAfter = defineFixture({ width: 1100, render: view([fork]) })
