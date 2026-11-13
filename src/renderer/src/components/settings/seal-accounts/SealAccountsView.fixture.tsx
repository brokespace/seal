import { defineFixture } from '../../../component-fixtures/component-fixture'
import {
  defaultSealAccountsConfig,
  defaultSealAutoSwapSettings
} from '../../../../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountCandidate } from '../../../../../shared/seal-accounts/seal-account-candidates'
import type { SealAccountsStatus } from '../../../../../shared/seal-accounts/seal-accounts-status'
import { SettingsGroup, SettingsGroupSubsection } from '../section-layout/SettingsGroup'
import { SealSessionAccountMenu } from '../../seal-session/SealSessionAccountMenu'
import { SealSessionRows, SealSwapRows } from './SealActivityRows'
import { SealAccountsView, type SealAccountsActions } from './SealAccountsView'
import { SealApiKeyRows } from './SealApiKeyRows'
import { SealFleetRows } from './SealFleetRows'
import { SealPolicyRules } from './SealPolicyRules'

const NOW = Date.UTC(2026, 10, 13, 18, 0)
const HOUR = 60 * 60 * 1000

function candidate(overrides: Partial<SealAccountCandidate> & Pick<SealAccountCandidate, 'key'>) {
  return {
    provider: 'claude',
    kind: 'oauth',
    localId: overrides.key,
    email: null,
    label: overrides.key,
    plan: null,
    priority: 100,
    disabled: false,
    active: false,
    launchable: true,
    authFailure: false,
    usage: null,
    sessionThreshold: null,
    weeklyThreshold: null,
    ...overrides
  } satisfies SealAccountCandidate
}

function usage(session: number, weekly: number, models: { name: string; used: number }[] = []) {
  return {
    session: { usedPercent: session, resetsAt: NOW + 2.5 * HOUR },
    weekly: { usedPercent: weekly, resetsAt: NOW + 70 * HOUR },
    models: models.map((model) => ({
      name: model.name,
      usedPercent: model.used,
      resetsAt: NOW + 70 * HOUR
    })),
    planType: null,
    updatedAt: NOW,
    error: null
  }
}

const config = defaultSealAccountsConfig()
config.autoSwap.claude = { ...defaultSealAutoSwapSettings(), enabled: true }
config.profiles['claude:work@example.com'] = { alias: 'Work Max', priority: 10 }
config.apiKeys = [
  { id: 'k1', provider: 'claude', label: 'Team overflow', keyHint: '9f2c', createdAt: NOW }
]
config.projects = [
  {
    match: 'github.com/acme/*',
    label: 'Acme repos',
    claude: { allow: ['claude:work@example.com'], default: 'claude:work@example.com' }
  }
]
config.machines = [{ machine: 'ssh:build-box', label: 'build-box', codex: { allow: [] } }]

const status: SealAccountsStatus = {
  machineKey: 'local',
  config,
  providers: {
    claude: {
      candidates: [
        candidate({
          key: 'claude:work@example.com',
          email: 'work@example.com',
          label: 'Work Max',
          plan: 'Max 20x',
          priority: 10,
          active: true,
          usage: usage(92, 41, [{ name: 'Fable', used: 63 }]),
          swapEstimate: { at: NOW, window: '5h', line: 90 },
          nextPollAt: NOW + 60 * 1000
        }),
        candidate({
          key: 'claude:me@example.com',
          email: 'me@example.com',
          label: 'me@example.com',
          plan: 'Pro',
          usage: usage(18, 22),
          swapEstimate: { at: NOW + 95 * 60 * 1000, window: '5h', line: 90 },
          nextPollAt: NOW + 3 * 60 * 1000
        }),
        candidate({
          key: 'claude:old@example.com',
          email: 'old@example.com',
          label: 'old@example.com',
          authFailure: true,
          usage: { ...usage(0, 0), error: 'Login expired' }
        }),
        candidate({ key: 'claude-key:k1', kind: 'api-key', label: 'Team overflow' })
      ],
      machineAllow: null,
      machineDefault: null,
      lastDecision: {
        at: NOW,
        summary: 'Swapped to me@example.com: Work Max passed 90% of its 5h window.'
      }
    },
    codex: {
      candidates: [
        candidate({
          key: 'codex:me@example.com',
          provider: 'codex',
          email: 'me@example.com',
          label: 'me@example.com',
          plan: 'Plus',
          active: true,
          usage: usage(35, 58)
        })
      ],
      machineAllow: null,
      machineDefault: null,
      lastDecision: null
    }
  },
  quarantine: { 'claude:old@example.com': { until: NOW + HOUR, reason: 'Login expired' } },
  swapLog: [
    {
      at: NOW - 5 * 60 * 1000,
      provider: 'claude',
      from: 'claude:work@example.com',
      to: 'claude:me@example.com',
      toLabel: 'me@example.com',
      reason: 'threshold'
    }
  ],
  sessions: [
    {
      id: 's1',
      at: NOW - 20 * 60 * 1000,
      provider: 'claude',
      accountKey: 'claude:me@example.com',
      accountLabel: 'me@example.com',
      reason: 'project-default',
      worktreeId: 'w1',
      tabId: 't1',
      projectLabel: 'acme/api',
      machineKey: 'local',
      warnings: [],
      liveSwap: 'inherit',
      history: [
        {
          at: NOW - 5 * 60 * 1000,
          from: 'claude:work@example.com',
          fromLabel: 'Work Max',
          to: 'claude:me@example.com',
          toLabel: 'me@example.com',
          reason: 'threshold',
          delivery: 'live'
        }
      ]
    },
    {
      id: 's2',
      at: NOW - 50 * 60 * 1000,
      provider: 'codex',
      accountKey: 'codex:me@example.com',
      accountLabel: 'me@example.com',
      reason: 'machine-default',
      worktreeId: 'w2',
      tabId: 't2',
      projectLabel: 'acme/web',
      machineKey: 'local',
      warnings: [],
      endedAt: NOW - 10 * 60 * 1000,
      history: [
        {
          at: NOW - 30 * 60 * 1000,
          from: 'codex:old@example.com',
          fromLabel: 'old@example.com',
          to: 'codex:me@example.com',
          toLabel: 'me@example.com',
          reason: 'rate-limit',
          delivery: 'resume'
        }
      ]
    }
  ],
  workspacePins: {},
  secretStorage: { available: true, protectionGap: null }
}

const resolved = async (): Promise<boolean> => true
const actions: SealAccountsActions = {
  refresh: () => {},
  use: () => {},
  saveProfile: resolved,
  setAutoSwap: () => {},
  evaluate: () => {},
  savePolicy: resolved,
  removePolicy: () => {},
  addApiKey: resolved,
  removeApiKey: () => {},
  syncHost: async () => null,
  swapSession: () => {},
  setSessionLiveSwap: () => {}
}

export const dashboard = defineFixture({
  width: 760,
  render: () => (
    <SealAccountsView
      status={status}
      error={null}
      refreshing={false}
      now={NOW}
      fleetHosts={[{ id: 'env-1', label: 'build-box (SSH)' }]}
      actions={actions}
    />
  )
})

const labelOf = (key: string): string =>
  status.providers.claude.candidates.find((entry) => entry.key === key)?.label ?? key

// The full dashboard is taller than the fixture viewport; this shows the groups below the accounts.
export const rulesKeysAndActivity = defineFixture({
  width: 760,
  render: () => (
    <div className="space-y-8">
      <SettingsGroup title="Account rules">
        <SealPolicyRules config={config} labelOf={labelOf} onRemove={() => {}} />
      </SettingsGroup>
      <SettingsGroup title="API keys">
        <SealApiKeyRows apiKeys={config.apiKeys} onRemove={() => {}} />
      </SettingsGroup>
      <SettingsGroup title="Remote hosts">
        <SealFleetRows
          hosts={[{ id: 'env-1', label: 'build-box (SSH)' }]}
          loginCount={2}
          onSync={async () => null}
        />
      </SettingsGroup>
      <SettingsGroup title="Activity">
        <SettingsGroupSubsection title="Recent sessions">
          <SealSessionRows
            sessions={status.sessions}
            providers={status.providers}
            now={NOW}
            onSwap={() => {}}
            onSetLiveSwap={() => {}}
          />
        </SettingsGroupSubsection>
        <SettingsGroupSubsection title="Swaps">
          <SealSwapRows swaps={status.swapLog} labelOf={labelOf} />
        </SettingsGroupSubsection>
      </SettingsGroup>
    </div>
  )
})

// A terminal tab running a Seal session, with its account menu open.
export const sessionBadge = defineFixture({
  width: 420,
  render: () => (
    <div className="h-80">
      <div className="flex h-8 items-center gap-1 border-b border-border bg-card px-2 text-xs">
        <span className="truncate">claude: fix flaky login test</span>
        <SealSessionAccountMenu
          session={status.sessions[0]}
          candidates={status.providers.claude.candidates}
          readAt={NOW}
          onSwap={() => {}}
          onSetLiveSwap={() => {}}
          defaultOpen
        />
      </div>
    </div>
  )
})
