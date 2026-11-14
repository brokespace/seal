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
  HomeSession,
  HomeWorkspace
} from './home-overview-model'

const NOW = Date.now()
const MIN = 60_000

function session(id: string, overrides: Partial<HomeSession>): HomeSession {
  return {
    id,
    state: 'working',
    unseen: false,
    machineId: 'local',
    machineLabel: 'Local Mac',
    projectId: 'seal',
    projectName: 'seal',
    workspaceName: 'main',
    title: id,
    agentType: 'claude',
    agentLabel: 'Claude',
    startedAt: NOW - 14 * MIN,
    stateChangedAt: NOW - 2 * MIN,
    finishedAt: null,
    target: {
      kind: 'orca-pane',
      reveal: { repoId: 'seal', worktreeId: id, tabId: id, leafId: null }
    },
    ...overrides
  }
}

const SESSIONS: HomeSession[] = [
  session('Add Home overview page', {
    workspaceName: 'seal/home-overview',
    model: 'claude-opus-4',
    account: 'brian@example.com',
    lastMessage: { role: 'agent', text: 'Wired the sessions provider; running the typecheck now.' }
  }),
  session('Rebrand app icons', {
    state: 'permission',
    unseen: true,
    workspaceName: 'seal/rebrand',
    model: 'claude-sonnet-4',
    account: 'brian@example.com',
    askSummary: 'Run `pnpm build:icons`?'
  }),
  session('Multi-account switcher', {
    state: 'done',
    unseen: true,
    agentType: 'codex',
    agentLabel: 'Codex',
    model: 'gpt-5-codex',
    workspaceName: 'seal/multi-account',
    finishedAt: NOW - 6 * MIN,
    lastMessage: { role: 'agent', text: 'Opened PR #12 with the account picker and tests.' }
  }),
  session('Train tokenizer', {
    machineId: 'machine:gpu',
    machineLabel: 'gpu-box',
    projectId: 'ml',
    projectName: 'ml-experiments',
    workspaceName: 'tokenizer-v2',
    state: 'waiting',
    unseen: true,
    askSummary: 'Which dataset split should I use for validation?',
    startedAt: NOW - 3 * 60 * MIN
  }),
  session('Nightly eval', {
    machineId: 'machine:gpu',
    machineLabel: 'gpu-box',
    projectId: 'ml',
    projectName: 'ml-experiments',
    workspaceName: 'eval',
    state: 'errored',
    unseen: true,
    agentType: 'codex',
    agentLabel: 'Codex',
    finishedAt: NOW - 40 * MIN,
    errorSummary: 'CUDA out of memory',
    lastMessage: { role: 'agent', text: 'CUDA out of memory while loading checkpoint.' }
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
  sessions: HomeSession[]
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
  sessions: SESSIONS,
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
