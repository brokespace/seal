/** Static sample data behind the Home fixtures and tests. */
import type { ReactNode } from 'react'
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
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { sampleLiveSession } from '../live-sessions/live-session.test-fixture'

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

const SESSIONS: LiveSession[] = [
  session('Add Home overview page', {
    origin: 'seal',
    lastMessage: 'Wired the sessions provider; running the typecheck now.'
  }),
  session('Rebrand app icons', {
    origin: 'seal',
    status: 'needs-permission',
    statusDetail: 'Run `pnpm build:icons`?'
  }),
  session('Multi-account switcher', {
    provider: 'codex',
    status: 'idle',
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
  })
]

/** Adds a session whose summary is still being written. */
export const BUSY_HOME_SESSIONS: LiveSession[] = [
  ...SESSIONS,
  session('Fix flaky upload test', {
    status: 'idle',
    lastActivityAt: NOW - 1 * MIN,
    lastMessage: 'The retry now waits for the server to close the stream.',
    summaryPending: true
  })
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

const ACCOUNTS: HomeAccount[] = [
  {
    id: 'claude:active',
    provider: 'claude',
    providerLabel: 'Claude',
    label: 'brian@example.com',
    active: true,
    status: 'ok',
    windows: [
      { kind: 'session', usedPercent: 86, resetsAt: NOW + 95 * MIN },
      { kind: 'weekly', usedPercent: 41, resetsAt: NOW + 3 * 24 * 60 * MIN }
    ]
  },
  {
    id: 'claude:work',
    provider: 'claude',
    providerLabel: 'Claude',
    label: 'brian@work.example',
    active: false,
    status: 'ok',
    windows: [{ kind: 'session', usedPercent: 8, resetsAt: NOW + 4 * 60 * MIN }]
  },
  {
    id: 'codex:active',
    provider: 'codex',
    providerLabel: 'Codex',
    label: 'Codex',
    active: true,
    status: 'ok',
    windows: [
      { kind: 'session', usedPercent: 22, resetsAt: NOW + 3 * 60 * MIN },
      { kind: 'weekly', usedPercent: 57, resetsAt: NOW + 5 * 24 * 60 * MIN }
    ]
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
