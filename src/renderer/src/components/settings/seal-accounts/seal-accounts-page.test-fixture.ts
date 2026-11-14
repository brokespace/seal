import {
  defaultSealAccountsConfig,
  defaultSealAutoSwapSettings
} from '../../../../../shared/seal-accounts/seal-accounts-config'
import type {
  SealAccountCandidate,
  SealAccountUsage
} from '../../../../../shared/seal-accounts/seal-account-candidates'
import type { SealAccountsStatus } from '../../../../../shared/seal-accounts/seal-accounts-status'
import {
  buildSealFleetOverview,
  type SealFleetOverview
} from '../../../../../shared/seal-accounts/seal-fleet-overview'

export const FIXTURE_NOW = Date.UTC(2026, 10, 13, 18, 0)
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

function candidate(
  overrides: Partial<SealAccountCandidate> & Pick<SealAccountCandidate, 'key'>
): SealAccountCandidate {
  return {
    provider: 'claude',
    kind: 'oauth',
    localId: overrides.key,
    email: null,
    label: overrides.key,
    plan: null,
    credential: 'login',
    health: { state: 'ok' },
    priority: 100,
    disabled: false,
    active: false,
    launchable: true,
    authFailure: false,
    usage: null,
    sessionThreshold: null,
    weeklyThreshold: null,
    ...overrides
  }
}

function usage(session: number, weekly: number): SealAccountUsage {
  return {
    session: { usedPercent: session, resetsAt: FIXTURE_NOW + 2.5 * HOUR },
    weekly: { usedPercent: weekly, resetsAt: FIXTURE_NOW + 70 * HOUR },
    models: [],
    planType: null,
    updatedAt: FIXTURE_NOW,
    error: null
  }
}

const WORK = candidate({
  key: 'claude:work@acme.dev#Acme',
  email: 'work@acme.dev',
  orgName: 'Acme',
  label: 'Work Max',
  plan: 'Max 20x',
  priority: 10,
  active: true,
  usage: usage(82, 41),
  swapEstimate: { at: FIXTURE_NOW + 34 * MINUTE, window: '5h', line: 90 },
  nextPollAt: FIXTURE_NOW + MINUTE
})

const PERSONAL = candidate({
  key: 'claude:brian@example.com',
  email: 'brian@example.com',
  label: 'Personal',
  plan: 'Pro',
  kind: 'system',
  localId: null,
  systemLogin: true,
  priority: 20,
  usage: usage(18, 22),
  nextPollAt: FIXTURE_NOW + 3 * MINUTE
})

const CI_TOKEN = candidate({
  key: 'claude-key:tok1',
  kind: 'api-key',
  credential: 'setup-token',
  label: 'CI token',
  priority: 30
})

const CODEX = candidate({
  key: 'codex:brian@example.com',
  provider: 'codex',
  email: 'brian@example.com',
  orgName: 'Personal workspace',
  label: 'brian@example.com',
  plan: 'Plus',
  active: true,
  usage: usage(35, 58),
  nextPollAt: FIXTURE_NOW + 2 * MINUTE
})

const OVERFLOW_KEY = candidate({
  key: 'claude-key:k1',
  kind: 'api-key',
  credential: 'api-key',
  label: 'Team overflow'
})

function emptyStatus(): SealAccountsStatus {
  return {
    machineKey: 'local',
    config: defaultSealAccountsConfig(),
    providers: {
      claude: { candidates: [], machineAllow: null, machineDefault: null, lastDecision: null },
      codex: { candidates: [], machineAllow: null, machineDefault: null, lastDecision: null }
    },
    quarantine: {},
    swapLog: [],
    sessions: [],
    workspacePins: {},
    systemLogins: { claude: null, codex: null },
    migrationNotice: null,
    secretStorage: { available: true, protectionGap: null }
  }
}

function homeStatus(claude: SealAccountCandidate[]): SealAccountsStatus {
  const status = emptyStatus()
  status.config.autoSwap.claude = { ...defaultSealAutoSwapSettings(), enabled: true }
  status.config.profiles[WORK.key] = { alias: 'Work Max', priority: 10 }
  status.config.apiKeys = [
    { id: 'k1', provider: 'claude', label: 'Team overflow', keyHint: '9f2c', createdAt: 0 },
    {
      id: 'tok1',
      provider: 'claude',
      label: 'CI token',
      keyHint: 'x81a',
      createdAt: 0,
      credential: 'setup-token'
    }
  ]
  status.config.projects = [
    {
      match: 'github.com/acme/*',
      label: 'Acme repos',
      claude: { allow: [WORK.key], default: WORK.key }
    }
  ]
  status.config.machines = [
    {
      machine: 'runtime:env-build',
      label: 'build-box',
      claude: { allow: [WORK.key, CI_TOKEN.key] }
    }
  ]
  status.providers.claude.candidates = claude
  status.providers.claude.lastDecision = {
    at: FIXTURE_NOW - 5 * MINUTE,
    summary: 'Staying on Work Max: 82% of its 5h window, under the 90% line.'
  }
  status.providers.codex.candidates = [CODEX]
  status.systemLogins = {
    claude: { key: PERSONAL.key, email: 'brian@example.com', orgName: null, state: 'listed' },
    codex: null
  }
  status.swapLog = [
    {
      at: FIXTURE_NOW - 3 * HOUR,
      provider: 'claude',
      from: PERSONAL.key,
      to: WORK.key,
      toLabel: 'Work Max',
      reason: 'threshold'
    }
  ]
  status.sessions = [
    {
      id: 's1',
      at: FIXTURE_NOW - 20 * MINUTE,
      provider: 'claude',
      accountKey: WORK.key,
      accountLabel: 'Work Max',
      reason: 'project-default',
      worktreeId: 'w1',
      tabId: 't1',
      projectLabel: 'acme/api',
      machineKey: 'local',
      warnings: [],
      history: [
        {
          at: FIXTURE_NOW - 12 * MINUTE,
          from: PERSONAL.key,
          fromLabel: 'Personal',
          to: WORK.key,
          toLabel: 'Work Max',
          reason: 'manual',
          delivery: 'live'
        }
      ]
    }
  ]
  return status
}

function buildBoxStatus(): SealAccountsStatus {
  const status = emptyStatus()
  status.machineKey = 'build-box'
  status.providers.claude.candidates = [{ ...WORK, active: true, swapEstimate: null }]
  status.sessions = [
    {
      id: 'r1',
      at: FIXTURE_NOW - 50 * MINUTE,
      provider: 'claude',
      accountKey: WORK.key,
      accountLabel: 'Work Max',
      reason: 'machine-default',
      worktreeId: 'w9',
      tabId: 't9',
      projectLabel: 'acme/web',
      machineKey: 'build-box',
      warnings: []
    }
  ]
  return status
}

export type SealAccountsPageScenario = { status: SealAccountsStatus; overview: SealFleetOverview }

function scenario(home: SealAccountsStatus, remote: SealAccountsStatus | null) {
  return {
    status: home,
    overview: buildSealFleetOverview([
      { id: 'local', label: 'This computer', home: true, status: home, error: null },
      ...(remote
        ? [
            { id: 'env-build', label: 'build-box', home: false, status: remote, error: null },
            {
              id: 'machine:gpu',
              label: 'gpu-box',
              home: false,
              status: null,
              error: null,
              loginsOnly: { connected: true }
            }
          ]
        : [])
    ])
  }
}

export function populatedScenario(): SealAccountsPageScenario {
  const home = homeStatus([WORK, PERSONAL, CI_TOKEN, OVERFLOW_KEY])
  home.migrationNotice = {
    at: FIXTURE_NOW,
    merged: [{ provider: 'claude', label: 'work@acme.dev', removed: 2 }]
  }
  home.fleetCopies = { 'machine:gpu': [WORK.key] }
  return scenario(home, buildBoxStatus())
}

export function deadLoginScenario(): SealAccountsPageScenario {
  const dead: SealAccountCandidate = {
    ...WORK,
    active: false,
    authFailure: true,
    health: { state: 'dead', reason: 'expired' },
    usage: { ...usage(0, 0), session: null, weekly: null, error: 'Login expired' },
    swapEstimate: null
  }
  const expiring: SealAccountCandidate = {
    ...PERSONAL,
    active: true,
    health: { state: 'expiring', expiresAt: FIXTURE_NOW + 26 * HOUR }
  }
  const home = homeStatus([dead, expiring])
  home.quarantine[WORK.key] = { until: FIXTURE_NOW + HOUR, reason: 'Login expired' }
  return scenario(home, null)
}

export function emptyScenario(dismissedSystemLogin: boolean): SealAccountsPageScenario {
  const home = emptyStatus()
  if (dismissedSystemLogin) {
    home.systemLogins = {
      claude: { key: PERSONAL.key, email: 'brian@example.com', orgName: null, state: 'dismissed' },
      codex: null
    }
  }
  return scenario(home, null)
}
