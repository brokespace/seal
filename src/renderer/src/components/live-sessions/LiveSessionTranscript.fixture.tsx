import { defineFixture } from '../../component-fixtures/component-fixture'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { LiveSessionChat } from './LiveSessionChat'

const NOW = 1_800_000_000_000

// Rows the live reader decodes from the recorded Claude Code 2.1.325 transcripts in main/live-sessions/transcripts/__fixtures__.
const handOff: NativeChatMessage[] = [
  {
    id: 'o439s',
    role: 'system',
    source: 'transcript',
    timestamp: 1799999400000,
    transcriptOffset: 439,
    blocks: [
      {
        type: 'text',
        text: 'Context compacted',
        presentation: 'compaction'
      }
    ]
  },
  {
    id: 'o439',
    role: 'user',
    source: 'transcript',
    timestamp: 1799999420000,
    transcriptOffset: 439,
    blocks: [
      {
        type: 'text',
        text: 'What failed on the last deploy?'
      }
    ]
  },
  {
    id: 'o2041',
    role: 'assistant',
    source: 'transcript',
    timestamp: 1799999440000,
    transcriptOffset: 2041,
    blocks: [
      {
        type: 'text',
        text: 'The answer is 42.'
      }
    ]
  }
]

const compacted: NativeChatMessage[] = [
  {
    id: 'o310',
    role: 'user',
    source: 'transcript',
    timestamp: 1799999460000,
    transcriptOffset: 310,
    blocks: [
      {
        type: 'text',
        text: 'What is the answer?'
      }
    ]
  },
  {
    id: 'o1729',
    role: 'assistant',
    source: 'transcript',
    timestamp: 1799999480000,
    transcriptOffset: 1729,
    blocks: [
      {
        type: 'text',
        text: 'The answer is 42.'
      }
    ]
  },
  {
    id: 'o3368',
    role: 'user',
    source: 'transcript',
    timestamp: 1799999500000,
    transcriptOffset: 3368,
    blocks: [
      {
        type: 'text',
        text: 'Try again please'
      }
    ]
  },
  {
    id: 'o3920',
    role: 'assistant',
    source: 'transcript',
    timestamp: 1799999520000,
    transcriptOffset: 3920,
    blocks: [
      {
        type: 'text',
        text: 'API Error: 400 Simulated outage'
      }
    ]
  },
  {
    id: 'o5582',
    role: 'user',
    source: 'transcript',
    timestamp: 1799999540000,
    transcriptOffset: 5582,
    blocks: [
      {
        type: 'text',
        text: 'And now?'
      }
    ]
  },
  {
    id: 'o6126',
    role: 'assistant',
    source: 'transcript',
    timestamp: 1799999560000,
    transcriptOffset: 6126,
    blocks: [
      {
        type: 'text',
        text: 'Done. The answer is 42.'
      }
    ]
  },
  {
    id: 'o8664',
    role: 'system',
    source: 'transcript',
    timestamp: 1799999580000,
    transcriptOffset: 8664,
    blocks: [
      {
        type: 'text',
        text: 'Context compacted',
        presentation: 'compaction'
      }
    ]
  },
  {
    id: 'o12578',
    role: 'user',
    source: 'transcript',
    timestamp: 1799999600000,
    transcriptOffset: 12578,
    blocks: [
      {
        type: 'text',
        text: 'After compaction, what was it?'
      }
    ]
  },
  {
    id: 'o14150',
    role: 'assistant',
    source: 'transcript',
    timestamp: 1799999620000,
    transcriptOffset: 14150,
    blocks: [
      {
        type: 'text',
        text: 'The answer is 42.'
      }
    ]
  }
]

const session: LiveSession = {
  id: 'recorded',
  provider: 'claude',
  providerSessionId: '6a278a68-fb5f-4a43-8007-6af95f274293',
  machine: { hostId: 'local', label: 'brian-mbp', kind: 'local' },
  origin: 'external',
  cwd: '/Users/brian/code/seal',
  project: 'seal',
  title: 'What is the answer?',
  status: 'waiting-input',
  statusSource: 'transcript',
  statusDetail: null,
  lastActivityAt: NOW - 60_000,
  startedAt: NOW - 3_600_000,
  alive: true,
  pid: 4242,
  transcriptPath: '/Users/brian/.claude/projects/-Users-brian-code-seal/6a278a68.jsonl',
  inputRoutes: [{ kind: 'tmux', target: '%3' }],
  permission: null
}

const noop = () => {}

function recorded(messages: NativeChatMessage[], height: string): React.JSX.Element {
  return (
    <div className={`flex ${height}`}>
      <LiveSessionChat
        session={session}
        transcript={{
          phase: 'ready',
          error: null,
          messages,
          hasMore: false,
          loadingEarlier: false,
          loadEarlier: async () => 'exhausted' as const
        }}
        pending={[]}
        onSend={noop}
        onRetry={noop}
        onAnswer={noop}
        answering={null}
      />
    </div>
  )
}

export const sealHandOff = defineFixture({
  width: 800,
  render: () => recorded(handOff, 'h-[420px]')
})

export const resumedAndCompacted = defineFixture({
  width: 800,
  render: () => recorded(compacted, 'h-[820px]')
})
