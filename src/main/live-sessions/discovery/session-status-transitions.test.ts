import { describe, expect, it } from 'vitest'
import type { LiveSessionStatus } from '../../../shared/live-sessions/live-session-types'
import {
  CLAUDE_SHELL,
  CODEX_APP_SERVER,
  CODEX_COMMAND,
  CODEX_SHELL,
  recordedSession,
  scan,
  type ScanOptions
} from './session-scan.test-fixture'

type Step = {
  /** What happened on the host since the last scan. */
  when: string
  host: ScanOptions
  shows: LiveSessionStatus
  detail?: string | null
}

type Transitions = { session: string; fixture: string; steps: Step[] }

const GONE: ScanOptions = { alive: false, listsProcesses: true, quietMs: 10 * 60_000 }
/** Its process left the host's list seconds after its last write. */
const KILLED: ScanOptions = { alive: false, listsProcesses: true }

// One scanner follows each session from scan to scan. Claude transcripts were recorded from Claude
// Code 2.1.325 (docs/design/agent-status.md says how); `records` is how much of one was written.
const CLAUDE: Transitions[] = [
  {
    session: 'a command started in the background outlives its turn',
    fixture: 'live-claude-background-command-finished',
    steps: [
      { when: 'the command was launched', host: { records: 5, quietMs: 1_000 }, shows: 'working' },
      {
        when: 'the turn ended and Claude says its shell runs',
        host: { records: 7, registry: { state: 'shell' } },
        shows: 'waiting-task',
        detail: 'Waiting on 1 background task'
      },
      {
        when: 'a Claude that writes no state, with the command under it',
        host: { records: 7, children: CLAUDE_SHELL('00:20') },
        shows: 'waiting-task'
      },
      {
        when: 'a host that lists no processes',
        host: { records: 7 },
        shows: 'waiting-task'
      },
      {
        when: 'the command ended and woke Claude',
        host: { records: 13, quietMs: 1_000, registry: { state: 'busy' } },
        shows: 'working'
      },
      { when: 'Claude reported', host: { registry: { state: 'idle' } }, shows: 'your-turn' }
    ]
  },
  {
    session: 'a log watcher and a polling loop left running (the reported session)',
    fixture: 'live-claude-background-command-running',
    steps: [
      {
        when: 'the turn ended on "pinning is still in progress"',
        host: { registry: { state: 'shell' }, children: CLAUDE_SHELL('00:20') },
        shows: 'waiting-task',
        detail: 'Waiting on 1 background task'
      },
      {
        when: 'hours later, still watching',
        host: {
          quietMs: 5 * 60 * 60_000,
          registry: { state: 'shell' },
          children: CLAUDE_SHELL('05:00:00')
        },
        shows: 'waiting-task'
      },
      {
        when: 'the watcher was killed outside Claude',
        host: { quietMs: 5 * 60 * 60_000, registry: { state: 'idle', afterWriteMs: 60_000 } },
        shows: 'your-turn'
      },
      { when: 'Claude was killed', host: GONE, shows: 'done' }
    ]
  },
  {
    session: 'a background command whose launch the scan never read',
    fixture: 'live-claude-background-command-running',
    steps: [
      {
        when: 'Claude says its shell runs',
        host: { readFrom: 8, registry: { state: 'shell' } },
        shows: 'waiting-task',
        detail: 'Waiting on 1 background task'
      }
    ]
  },
  {
    session: 'a background command on a Claude that writes no state, launch unread',
    fixture: 'live-claude-background-command-running',
    steps: [
      {
        when: 'the command runs under it',
        host: { readFrom: 8, children: CLAUDE_SHELL('00:20') },
        shows: 'waiting-task'
      }
    ]
  },
  {
    session: 'a "still running" check-in on a quiet background command',
    fixture: 'claude-background-command-check-in',
    steps: [
      {
        when: 'the turn ended',
        host: { records: 11, registry: { state: 'shell' } },
        shows: 'waiting-task'
      },
      {
        when: 'the check-in woke Claude',
        host: { records: 17, quietMs: 1_000, registry: { state: 'busy' } },
        shows: 'working'
      },
      {
        when: 'Claude left the command running',
        host: {},
        shows: 'waiting-task',
        detail: 'Waiting on 1 background task'
      }
    ]
  },
  {
    session: 'a Monitor watch that reports events while it runs',
    fixture: 'live-claude-monitor-watch',
    steps: [
      {
        when: 'the turn ended with the monitor watching',
        host: { records: 7 },
        shows: 'waiting-task',
        detail: 'Waiting on 1 background task'
      },
      {
        when: 'an event woke Claude',
        host: { records: 13, quietMs: 1_000 },
        shows: 'working'
      },
      {
        when: 'Claude noted it; the monitor still runs',
        host: { records: 15 },
        shows: 'waiting-task'
      },
      { when: 'a second event was noted', host: { records: 20 }, shows: 'waiting-task' },
      {
        when: 'the stream ended and woke Claude',
        host: { records: 23, quietMs: 1_000 },
        shows: 'working'
      },
      { when: 'Claude reported', host: {}, shows: 'your-turn' }
    ]
  },
  {
    session: 'a Monitor watch whose closing notice never came',
    fixture: 'live-claude-monitor-watch',
    steps: [
      { when: 'within its 90 s', host: { records: 7, quietMs: 60_000 }, shows: 'waiting-task' },
      {
        when: 'well past its timeout',
        host: { records: 7, quietMs: 5 * 60_000 },
        shows: 'your-turn'
      }
    ]
  },
  {
    session: 'a foreground command its timeout moved to the background',
    fixture: 'live-claude-command-moved-to-background',
    steps: [
      {
        when: 'the command runs in the foreground',
        host: { records: 4, quietMs: 4_000, children: CLAUDE_SHELL('00:04') },
        shows: 'running-shell'
      },
      {
        when: 'it was moved to the background and the turn ended',
        host: { records: 11, registry: { state: 'shell' } },
        shows: 'waiting-task'
      },
      { when: 'it finished and Claude reported', host: {}, shows: 'your-turn' }
    ]
  },
  {
    session: 'a wake-up Claude scheduled for itself',
    fixture: 'live-claude-scheduled-wakeup',
    steps: [
      {
        when: 'the turn ended with the wake-up 115 s away',
        host: { records: 11, registry: { state: 'idle' } },
        shows: 'waiting-task',
        detail: 'Waiting on 1 background task'
      },
      { when: 'the wake-up fired', host: { records: 14, quietMs: 1_000 }, shows: 'working' },
      { when: 'Claude reported', host: {}, shows: 'your-turn' }
    ]
  },
  {
    session: 'a wake-up that never fired',
    fixture: 'live-claude-scheduled-wakeup',
    steps: [
      {
        when: 'long past its time',
        host: { records: 11, quietMs: 10 * 60_000 },
        shows: 'your-turn'
      }
    ]
  },
  {
    session: 'a subagent running in the background',
    fixture: 'live-claude-background-agent',
    steps: [
      {
        when: 'the turn ended with the subagent at work',
        host: { records: 11, registry: { state: 'busy' } },
        shows: 'waiting-subagent',
        detail: 'Waiting on 1 subagent'
      },
      {
        when: 'the subagent reported back and woke Claude',
        host: { records: 15, quietMs: 1_000 },
        shows: 'working'
      },
      { when: 'Claude reported', host: { registry: { state: 'idle' } }, shows: 'your-turn' }
    ]
  },
  {
    session: 'a question put to the user',
    fixture: 'live-claude-question-open',
    steps: [
      {
        when: 'the question is up',
        host: { registry: { state: 'waiting', waitingFor: 'input needed' } },
        shows: 'waiting-input',
        detail: 'Which database should the migration target?'
      },
      {
        when: 'ten minutes on, unanswered',
        host: { quietMs: 10 * 60_000, listsProcesses: true },
        shows: 'waiting-input'
      },
      {
        when: 'a host that cannot list processes stops showing the agent',
        host: { alive: false, quietMs: 10 * 60_000 },
        shows: 'waiting-input'
      },
      { when: 'Claude was killed with the question open', host: KILLED, shows: 'done' }
    ]
  },
  {
    session: 'a permission prompt',
    fixture: 'live-claude-approval-pending',
    steps: [
      {
        when: 'Claude says a prompt is up, one second in',
        host: { quietMs: 1_000, registry: { state: 'waiting', waitingFor: 'permission prompt' } },
        shows: 'needs-permission',
        detail: 'Allow Bash: Remove the build output?'
      },
      {
        when: 'it was answered elsewhere and the command runs',
        host: { quietMs: 30_000, registry: { state: 'busy' }, children: [] },
        shows: 'working'
      },
      { when: 'Claude was killed at the prompt', host: KILLED, shows: 'done' }
    ]
  },
  {
    session: 'a turn the API refused',
    fixture: 'live-claude-api-error',
    steps: [
      { when: 'the turn failed', host: { registry: { state: 'idle' } }, shows: 'errored' },
      {
        when: 'its hooks then wrote "done"',
        host: { registry: { state: 'idle' }, hook: { state: 'done' } },
        shows: 'errored'
      },
      {
        when: 'Claude exited',
        host: { ...GONE, hook: { state: 'done', agoMs: 9 * 60_000 } },
        shows: 'errored'
      }
    ]
  },
  {
    session: 'a command interrupted with Esc',
    fixture: 'live-claude-interrupted-command',
    steps: [
      {
        when: 'the command runs',
        host: { records: 4, quietMs: 30_000, children: CLAUDE_SHELL('00:30') },
        shows: 'running-shell'
      },
      {
        when: 'Esc: no hook fires, so the hook file still says working',
        host: { hook: { state: 'working', agoMs: 60_000 }, registry: { state: 'idle' } },
        shows: 'your-turn',
        detail: 'Interrupted'
      }
    ]
  },
  {
    session: 'a turn Claude dropped without a word in its transcript',
    fixture: 'live-claude-shell-pending',
    steps: [
      { when: 'the call is pending', host: { quietMs: 2_000 }, shows: 'working' },
      {
        when: 'Claude says it is idle, long after the last write',
        host: { quietMs: 60_000, registry: { state: 'idle', afterWriteMs: 30_000 } },
        shows: 'your-turn'
      }
    ]
  },
  {
    session: 'a finished turn Claude still works past (compaction, delegated work)',
    fixture: 'claude-idle',
    steps: [
      { when: 'Claude says it is busy', host: { registry: { state: 'busy' } }, shows: 'working' },
      { when: 'Claude says it is idle', host: { registry: { state: 'idle' } }, shows: 'your-turn' }
    ]
  }
]

const CODEX: Transitions[] = [
  {
    session: 'an approval Codex asked for',
    fixture: 'codex-needs-permission',
    steps: [
      { when: 'the request is up', host: {}, shows: 'needs-permission' },
      {
        when: 'ten minutes on, on a host that lists no processes',
        host: { alive: false, quietMs: 10 * 60_000 },
        shows: 'needs-permission',
        detail: 'Allow bash -lc rm -rf dist .cache?'
      },
      {
        when: 'its terminal closed but an app-server still holds the thread',
        host: {
          alive: false,
          listsProcesses: true,
          quietMs: 10 * 60_000,
          processes: [CODEX_APP_SERVER],
          heldOpenBy: 4300
        },
        shows: 'needs-permission'
      },
      { when: 'Codex was killed', host: KILLED, shows: 'done' }
    ]
  },
  {
    session: 'a question Codex asked through its question tool',
    fixture: 'live-codex-ask-pending',
    steps: [
      { when: 'the question is up', host: {}, shows: 'waiting-input' },
      { when: 'Codex was killed', host: KILLED, shows: 'done' }
    ]
  },
  {
    session: 'a command Codex left running in a background terminal',
    fixture: 'live-codex-background-terminal',
    steps: [
      {
        when: 'the command runs',
        host: { records: 6, children: CODEX_COMMAND('00:01') },
        shows: 'running-shell'
      },
      {
        when: 'Codex ended its turn with the command still running',
        host: { listsProcesses: true, children: CODEX_COMMAND('00:20') },
        shows: 'waiting-task',
        detail: 'Waiting on 1 background task'
      },
      {
        when: 'an hour on',
        host: { listsProcesses: true, children: CODEX_COMMAND('1:00:00'), quietMs: 60 * 60_000 },
        shows: 'waiting-task'
      },
      { when: 'on a host that lists no processes', host: {}, shows: 'waiting-task' },
      {
        when: 'the command was killed outside Codex',
        host: { listsProcesses: true, children: [] },
        shows: 'your-turn'
      },
      { when: 'Codex was killed', host: KILLED, shows: 'done' }
    ]
  },
  {
    session: 'a command Codex polled until it exited',
    fixture: 'live-codex-terminal-polled',
    steps: [
      {
        when: 'the command outlived its call and Codex thinks',
        host: { records: 7, children: CODEX_COMMAND('00:30') },
        shows: 'working'
      },
      {
        when: 'Codex polls it',
        host: { records: 8, children: CODEX_COMMAND('00:31') },
        shows: 'running-shell'
      },
      {
        when: 'the poll saw it exit and the turn ended',
        host: { listsProcesses: true, children: [] },
        shows: 'your-turn'
      },
      {
        when: 'another command runs under the shared app-server',
        host: {
          listsProcesses: true,
          processes: [CODEX_APP_SERVER],
          children: CODEX_SHELL('00:05')
        },
        shows: 'your-turn'
      }
    ]
  },
  {
    session: 'two commands Codex left running in background terminals',
    fixture: 'live-codex-two-terminals',
    steps: [
      {
        when: 'Codex ended its turn with both running',
        host: { records: 12, listsProcesses: true, children: CODEX_COMMAND('00:20') },
        shows: 'waiting-task',
        detail: 'Waiting on 2 background tasks'
      },
      {
        when: 'one was killed and Codex wrote that it ended',
        host: { records: 13, listsProcesses: true, children: CODEX_COMMAND('01:20') },
        shows: 'waiting-task',
        detail: 'Waiting on 1 background task'
      },
      {
        when: 'the other ended while another session runs a command under the shared app-server',
        host: {
          listsProcesses: true,
          processes: [CODEX_APP_SERVER],
          children: CODEX_SHELL('00:05')
        },
        shows: 'your-turn'
      }
    ]
  },
  {
    session: 'a command Codex was polling when the user interrupted',
    fixture: 'live-codex-poll-interrupted',
    steps: [
      {
        when: 'Codex polls the command',
        host: { records: 8, children: CODEX_COMMAND('00:31') },
        shows: 'running-shell'
      },
      {
        when: 'Esc ended the turn and the command runs on in its terminal',
        host: { records: 10, listsProcesses: true, children: CODEX_COMMAND('01:00') },
        shows: 'waiting-task',
        detail: 'Waiting on 1 background task'
      },
      {
        when: 'the command ended',
        host: { listsProcesses: true, children: [] },
        shows: 'your-turn',
        detail: 'Interrupted'
      }
    ]
  },
  {
    session: 'a Codex turn that failed',
    fixture: 'live-codex-failed-turn',
    steps: [
      { when: 'the turn failed', host: {}, shows: 'errored' },
      { when: 'its hooks then wrote "idle"', host: { hook: { state: 'idle' } }, shows: 'errored' },
      { when: 'Codex exited', host: GONE, shows: 'errored' }
    ]
  }
]

describe.each([
  ['Claude Code', CLAUDE],
  ['Codex', CODEX]
])('status transitions of a %s session', (_, sessions) => {
  it.each(sessions)('$session', async ({ fixture, steps }) => {
    const scanOnce = recordedSession(fixture)
    const seen: Pick<Step, 'when' | 'shows' | 'detail'>[] = []
    for (const step of steps) {
      const session = await scanOnce(step.host)
      seen.push({
        when: step.when,
        shows: session.status,
        ...(step.detail !== undefined ? { detail: session.statusDetail } : {})
      })
    }
    expect(seen).toEqual(
      steps.map(({ when, shows, detail }) => ({
        when,
        shows,
        ...(detail !== undefined ? { detail } : {})
      }))
    )
  })
})

// A machine that just connected reads a few transcripts per scan (SSH_SCAN_LIMITS).
it.each([
  [
    'Claude Code',
    'live-claude-background-command-running',
    { registry: { state: 'shell' } },
    'waiting-task'
  ],
  ['Codex', 'live-codex-background-terminal', { children: CODEX_COMMAND('00:20') }, 'waiting-task']
] as const)(
  'a running %s session shows once its transcript is read, never as idle before',
  async (_, fixture, host, shows) => {
    const scanOnce = recordedSession(fixture)
    expect(await scanOnce({ ...host, unread: true })).toBeUndefined()
    expect((await scanOnce(host)).status).toBe(shows)
  }
)

it('a Claude started where an earlier session ended is a new session, not that one running again', async () => {
  const started = '7c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e9f'
  const sessions = await scan('claude-idle', {
    unpinned: true,
    listsProcesses: true,
    registry: { state: 'idle', sessionId: started }
  })
  expect(sessions.map((s) => [s.providerSessionId === started, s.alive]).sort()).toEqual([
    [false, false],
    [true, true]
  ])
})
