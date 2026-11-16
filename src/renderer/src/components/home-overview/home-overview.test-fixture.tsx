/** Static sample data behind the Home fixtures and tests. */
import type { ReactNode } from 'react'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import {
  HomeAccountsContext,
  HomeAutomationsContext,
  HomeMachinesContext,
  HomeSessionsContext,
  HomeWorkspacesContext
} from './home-overview-contexts'
import type {
  HomeAccount,
  HomeAutomationsResult,
  HomeMachine,
  HomeOverviewProviders,
  HomeWorkspace
} from './home-overview-model'
import type { AppState } from '@/store/types'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { sampleLiveSession } from '../live-sessions/live-session.test-fixture'
import { makeRepo, makeWorktree } from '../worktree-jump/worktree-jump-palette-test-fixtures'

const NOW = Date.now()
const MIN = 60_000

const GPU_BOX = {
  hostId: 'ssh-gpu',
  label: 'gpu-box',
  kind: 'remote',
  machineId: 'machine:gpu'
} as const

function session(title: string, patch: Partial<LiveSession>): LiveSession {
  return sampleLiveSession(title, {
    machine: { hostId: 'local', label: 'Local Mac', kind: 'local' },
    status: 'working',
    startedAt: NOW - 14 * MIN,
    lastActivityAt: NOW - 2 * MIN,
    ...patch
  })
}

const SEAL_REPO = { ...makeRepo(), id: 'seal', path: '/code/seal', displayName: 'seal' }

function sealWorkspace(name: string): NonNullable<LiveSession['workspace']> & { cwd: string } {
  const cwd = `/code/seal-${name}`
  return { worktreeId: `seal::${cwd}`, projectKey: 'github:brokespace/seal', cwd }
}

const HOME_OVERVIEW = sealWorkspace('home-overview')
const REBRAND = sealWorkspace('rebrand')
const MULTI_ACCOUNT = sealWorkspace('multi-account')

/** The catalogue that names the fixture sessions' project and workspaces. */
export const HOME_FIXTURE_STORE: Pick<AppState, 'repos' | 'worktreesByRepo'> = {
  repos: [SEAL_REPO],
  worktreesByRepo: {
    [SEAL_REPO.id]: [HOME_OVERVIEW, REBRAND, MULTI_ACCOUNT].map(({ worktreeId, cwd }) =>
      makeWorktree(worktreeId, cwd.slice('/code/seal-'.length), { repoId: SEAL_REPO.id, path: cwd })
    )
  }
}

function placed({ cwd, ...workspace }: ReturnType<typeof sealWorkspace>): Partial<LiveSession> {
  return { cwd, workspace }
}

// A chat, an agent in a pane and sessions started outside Seal, on two machines.
const SESSIONS: LiveSession[] = [
  session('Add Home overview page', {
    ...placed(HOME_OVERVIEW),
    origin: 'seal',
    surface: { kind: 'chat', sessionId: 'chat-home-overview', tabId: 'tab-home-overview' },
    lastMessage: 'Wired the sessions provider; running the typecheck now.'
  }),
  session('Rebrand app icons', {
    ...placed(REBRAND),
    origin: 'seal',
    surface: { kind: 'cli', paneKey: 'tab-rebrand:pane-1' },
    status: 'needs-permission',
    statusDetail: 'Run `pnpm build:icons`?'
  }),
  session('Multi-account switcher', {
    ...placed(MULTI_ACCOUNT),
    provider: 'codex',
    status: 'your-turn',
    lastMessage:
      'I pushed the branch and opened PR #12. It adds the account picker to the composer, a keyboard shortcut, and tests for the switch-on-limit path.',
    summary: 'Opened PR #12 with the account picker and its tests.'
  }),
  session('Train tokenizer', {
    machine: GPU_BOX,
    project: 'ml-experiments',
    cwd: '/srv/ml-experiments',
    status: 'waiting-input',
    statusDetail: 'Which dataset split should I use for validation?',
    summary: 'Needs you to pick the validation dataset split.',
    startedAt: NOW - 3 * 60 * MIN
  }),
  session('Nightly eval', {
    machine: GPU_BOX,
    provider: 'codex',
    project: 'ml-experiments',
    cwd: '/srv/ml-experiments',
    status: 'errored',
    statusDetail: 'CUDA out of memory',
    lastActivityAt: NOW - 40 * MIN
  }),
  session('Sweep learning rates', {
    machine: GPU_BOX,
    origin: 'seal',
    surface: { kind: 'chat', sessionId: 'chat-sweep', tabId: 'tab-sweep' },
    project: 'ml-experiments',
    cwd: '/srv/ml-experiments',
    statusDetail: 'Bash: python sweep.py --trials 40',
    startedAt: NOW - 50 * MIN
  })
]

/** Adds a session whose summary is still being written. */
export const BUSY_HOME_SESSIONS: LiveSession[] = [
  ...SESSIONS,
  session('Fix flaky upload test', {
    ...placed(HOME_OVERVIEW),
    status: 'your-turn',
    lastActivityAt: NOW - 1 * MIN,
    lastMessage: 'The retry now waits for the server to close the stream.',
    summaryPending: true
  })
]

const subagent = (id: string, title: string, running: boolean) => ({
  id,
  title,
  agentType: 'general-purpose',
  model: 'sonnet',
  status: running ? ('running' as const) : ('completed' as const),
  background: true,
  activity: running ? 'Read: webhook.ts' : null,
  startedAt: NOW - 4 * MIN,
  lastActivityAt: NOW - MIN,
  transcriptPath: null
})

/** One session in each status, in the order Home lists them. */
export const EVERY_STATUS_HOME_SESSIONS: LiveSession[] = [
  session('Rebrand app icons', {
    status: 'needs-permission',
    statusSource: 'screen',
    statusDetail: 'Allow Bash: pnpm build:icons?'
  }),
  session('Train tokenizer', {
    status: 'waiting-input',
    statusDetail: 'Which dataset split should I use for validation?',
    // Recap counts stay off the card: its status already says it waits on the user.
    recap: { title: 'Train tokenizer', rev: 2, questions: 2, actions: 2 }
  }),
  session('Nightly eval', {
    provider: 'codex',
    status: 'errored',
    statusDetail: 'CUDA out of memory',
    lastActivityAt: NOW - 40 * MIN
  }),
  session('Add Home overview page', {
    status: 'working',
    statusDetail: 'Edit: HomeSessionsPanel.tsx'
  }),
  session('Migrate the orders table', {
    status: 'running-shell',
    statusSource: 'process',
    statusDetail: 'Bash: pnpm migrate:up --all',
    startedAt: NOW - 6 * MIN
  }),
  session('Audit payment webhooks', {
    status: 'waiting-subagent',
    statusDetail: 'Waiting on 2 subagents',
    activity: {
      subagents: [
        subagent('a1', 'Audit the Stripe webhook', true),
        subagent('a2', 'Audit the PayPal webhook', true),
        subagent('a3', 'List the webhook routes', false)
      ],
      tasks: [],
      todos: []
    }
  }),
  session('Profile the dev server', {
    status: 'waiting-task',
    statusDetail: 'Waiting on 1 background task',
    activity: {
      subagents: [],
      tasks: [
        {
          id: 'bash_4',
          label: 'pnpm dev --port 4310',
          status: 'running',
          startedAt: NOW - 3 * MIN,
          summary: null
        }
      ],
      todos: []
    }
  }),
  session('Multi-account switcher', {
    provider: 'codex',
    status: 'your-turn',
    summary: 'Opened PR #12 with the account picker and its tests.',
    lastActivityAt: NOW - 9 * MIN
  }),
  session('Scratch', { status: 'idle', title: null, lastActivityAt: NOW - 25 * MIN })
]

const MACHINES: HomeMachine[] = [
  {
    id: 'local',
    label: 'Local Mac',
    kind: 'local',
    status: 'online',
    load: 0.32,
    memoryUsedPercent: 61
  },
  { id: 'machine:gpu', label: 'gpu-box', kind: 'ssh', status: 'online' },
  { id: 'machine:pi', label: 'raspberry-pi', kind: 'ssh', status: 'offline' },
  {
    id: 'machine:old',
    label: 'old-server',
    kind: 'ssh',
    status: 'error',
    error: 'Authentication failed'
  }
]

function limits(
  provider: ProviderRateLimits['provider'],
  session: number,
  weekly: number | null
): ProviderRateLimits {
  return {
    provider,
    session: {
      usedPercent: session,
      windowMinutes: 300,
      resetsAt: NOW + 95 * MIN,
      resetDescription: null
    },
    weekly:
      weekly === null
        ? null
        : {
            usedPercent: weekly,
            windowMinutes: 10_080,
            resetsAt: NOW + 3 * 24 * 60 * MIN,
            resetDescription: null
          },
    updatedAt: NOW,
    error: null,
    status: 'ok'
  }
}

const ACCOUNTS: HomeAccount[] = [
  {
    id: 'claude:active',
    provider: 'claude',
    providerLabel: 'Claude',
    label: 'brian@example.com',
    active: true,
    limits: limits('claude', 86, 41),
    fetching: false
  },
  {
    id: 'claude:work',
    provider: 'claude',
    providerLabel: 'Claude',
    label: 'brian@work.example',
    active: false,
    limits: limits('claude', 8, null),
    fetching: false
  },
  {
    id: 'codex:active',
    provider: 'codex',
    providerLabel: 'Codex',
    label: 'Codex',
    active: true,
    limits: limits('codex', 22, 57),
    fetching: false
  }
]

const WORKSPACES: HomeWorkspace[] = [
  { id: 'a', projectName: 'seal', name: 'seal/home-overview', machineId: 'local', isFolder: false },
  {
    id: 'b',
    projectName: 'seal',
    name: 'seal/multi-account',
    machineId: 'local',
    isFolder: false,
    review: { number: 12, state: 'open' }
  },
  {
    id: 'c',
    projectName: 'seal',
    name: 'seal/rebrand',
    machineId: 'local',
    isFolder: false,
    review: { number: 9, state: 'draft' }
  },
  {
    id: 'd',
    projectName: 'ml-experiments',
    name: 'tokenizer-v2',
    machineId: 'ssh:gpu',
    isFolder: false
  }
]

const AUTOMATIONS: HomeAutomationsResult = {
  status: 'ready',
  automations: [
    {
      id: '1',
      name: 'Nightly dependency bump',
      enabled: true,
      nextRunAt: NOW + 7 * 60 * MIN,
      lastRunAt: null
    },
    {
      id: '2',
      name: 'Triage new issues',
      enabled: true,
      nextRunAt: NOW + 25 * MIN,
      lastRunAt: null
    },
    { id: '3', name: 'Weekly release notes', enabled: false, nextRunAt: null, lastRunAt: null }
  ]
}

type Children = { children: ReactNode }

// Unset contexts keep their no-op defaults, so Actions passes children through.
function PassThrough({ children }: Children): React.JSX.Element {
  return <>{children}</>
}

function staticProviders(data: {
  sessions: LiveSession[]
  machines: HomeMachine[]
  accounts: HomeAccount[]
  workspaces: HomeWorkspace[]
  automations: HomeAutomationsResult
}): HomeOverviewProviders {
  return {
    Sessions: ({ children }: Children) => (
      <HomeSessionsContext.Provider value={data.sessions}>{children}</HomeSessionsContext.Provider>
    ),
    Machines: ({ children }: Children) => (
      <HomeMachinesContext.Provider value={data.machines}>{children}</HomeMachinesContext.Provider>
    ),
    Accounts: ({ children }: Children) => (
      <HomeAccountsContext.Provider value={data.accounts}>{children}</HomeAccountsContext.Provider>
    ),
    Workspaces: ({ children }: Children) => (
      <HomeWorkspacesContext.Provider value={data.workspaces}>
        {children}
      </HomeWorkspacesContext.Provider>
    ),
    Automations: ({ children }: Children) => (
      <HomeAutomationsContext.Provider value={data.automations}>
        {children}
      </HomeAutomationsContext.Provider>
    ),
    Actions: PassThrough
  }
}

export const BUSY_HOME_PROVIDERS = staticProviders({
  sessions: BUSY_HOME_SESSIONS,
  machines: MACHINES,
  accounts: ACCOUNTS,
  workspaces: WORKSPACES,
  automations: AUTOMATIONS
})

export const EMPTY_HOME_PROVIDERS = staticProviders({
  sessions: [],
  machines: [MACHINES[0]],
  accounts: [],
  workspaces: [],
  automations: { status: 'ready', automations: [] }
})
