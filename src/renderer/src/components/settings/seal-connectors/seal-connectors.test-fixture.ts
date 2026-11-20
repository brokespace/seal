import {
  APPLIES_TO_ALL,
  emptySealConnectorsConfig,
  type Connector,
  type SealConnectorsConfig,
  type SealConnectorsFleetHost,
  type SealConnectorsHostStatus,
  type SignInHostState,
  type SignInRef
} from '../../../../../shared/seal-connectors/seal-connectors-types'
import type { SealConnectors } from './use-seal-connectors'

export const FIXTURE_NOW = 1_800_000_000_000
const HOUR = 3_600_000

const DESK = 'host:desk-1111'
const KESSEL = 'host:kessel-2222'

const scoped = { enabled: true, appliesTo: APPLIES_TO_ALL, projectOverrides: [] }

function signIn(id: string, label: string, overrides: Partial<SignInRef> = {}): SignInRef {
  return { ...scoped, id, label, kind: 'oauth', createdAt: FIXTURE_NOW - 24 * HOUR, ...overrides }
}

const slack: Connector = {
  ...scoped,
  id: 'slack',
  name: 'slack',
  title: 'Slack',
  transport: { type: 'http', url: 'https://mcp.slack.com/mcp', oauth: { callbackPort: 3118 } },
  source: { kind: 'plugin', pluginId: 'slack@claude-plugins-official' },
  auth: 'oauth',
  signIns: [
    signIn('slack-acme', 'Acme workspace', {
      appliesTo: { machines: 'all', accounts: ['claude:work@acme.dev'], harnesses: 'all' }
    }),
    signIn('slack-side', 'Side project', {
      appliesTo: { machines: [KESSEL], accounts: 'all', harnesses: ['claude', 'codex'] }
    })
  ],
  disabledTools: ['slack_delete_message']
}

const atlassian: Connector = {
  ...scoped,
  id: 'atlassian',
  name: 'atlassian',
  title: 'Atlassian',
  transport: { type: 'http', url: 'https://mcp.atlassian.com/v1/sse' },
  source: { kind: 'catalog', harness: 'claude', listing: 'atlassian@claude-plugins-official' },
  auth: 'oauth',
  signIns: [signIn('atlassian-main', 'Atlassian (from Claude Code on This computer)')],
  disabledTools: []
}

const codegraph: Connector = {
  ...scoped,
  id: 'codegraph',
  name: 'codegraph',
  title: 'codegraph',
  transport: { type: 'stdio', command: 'codegraph', args: ['serve', '--mcp'], env: {} },
  source: { kind: 'imported', fromHostKey: KESSEL, fromHarness: 'claude' },
  auth: 'none',
  signIns: [],
  disabledTools: [],
  appliesTo: { machines: 'all', accounts: 'all', harnesses: ['claude'] }
}

export const fixtureConfig: SealConnectorsConfig = {
  ...emptySealConnectorsConfig(),
  updatedAt: FIXTURE_NOW,
  connectors: [slack, atlassian, codegraph],
  plugins: [
    {
      ...scoped,
      id: 'slack@claude-plugins-official',
      name: 'slack',
      marketplace: 'claude-plugins-official',
      harness: 'claude',
      version: '1.2.0',
      description: 'Search Slack, read channels and post messages from agent sessions.',
      connectorIds: ['slack'],
      skillNames: ['slack-search', 'slack-summarize', 'slack-draft']
    },
    {
      ...scoped,
      id: 'atlassian@claude-plugins-official',
      name: 'atlassian',
      marketplace: 'claude-plugins-official',
      harness: 'claude',
      version: null,
      description: 'Jira and Confluence for agents.',
      connectorIds: ['atlassian'],
      skillNames: [],
      appliesTo: { machines: [DESK], accounts: 'all', harnesses: 'all' }
    }
  ],
  skills: [
    {
      ...scoped,
      id: 'slack-search',
      name: 'slack-search',
      description: 'Find messages, files and people across Slack.',
      source: { kind: 'plugin', pluginId: 'slack@claude-plugins-official' }
    },
    {
      ...scoped,
      id: 'review-checklist',
      name: 'review-checklist',
      description: 'Our code review checklist.',
      source: { kind: 'library', files: [] },
      appliesTo: { machines: 'all', accounts: 'all', harnesses: ['claude', 'codex'] }
    }
  ],
  refresher: { designatedHostKey: null },
  importedHosts: [DESK, KESSEL]
}

const states = (overrides: Record<string, Partial<SignInHostState>> = {}): SignInHostState[] =>
  ['slack-acme', 'slack-side', 'atlassian-main'].map((id) => ({
    id,
    present: true,
    updatedAt: FIXTURE_NOW - HOUR,
    expiresAt: FIXTURE_NOW + 6 * HOUR,
    needsReconnect: false,
    ...overrides[id]
  }))

function hostStatus(hostKey: string, signIns: SignInHostState[]): SealConnectorsHostStatus {
  return {
    hostKey,
    config: fixtureConfig,
    signIns,
    lease: { ownerHostKey: KESSEL, epoch: 4, heartbeatAt: FIXTURE_NOW - 12_000, grantedBy: DESK },
    refreshing: hostKey === KESSEL,
    relayPort: 43111,
    plugins: []
  }
}

export const fixtureOwnStatus = hostStatus(DESK, states({ 'slack-side': { needsReconnect: true } }))

export const fixtureHosts: SealConnectorsFleetHost[] = [
  {
    target: 'local',
    label: 'This computer',
    online: true,
    status: fixtureOwnStatus,
    error: null
  },
  {
    target: 'env-kessel',
    label: 'kessel-ml',
    online: true,
    status: hostStatus(
      KESSEL,
      states({
        'slack-acme': { updatedAt: FIXTURE_NOW - 30 * HOUR },
        'atlassian-main': { expiresAt: FIXTURE_NOW - HOUR }
      })
    ),
    error: null
  }
]

export function fixtureConnectors(
  overrides: Partial<SealConnectors> = {},
  config: SealConnectorsConfig = fixtureConfig
): SealConnectors {
  return {
    status: { ...fixtureOwnStatus, config },
    config,
    fleet: { hosts: fixtureHosts },
    error: null,
    loading: false,
    readAt: FIXTURE_NOW,
    refresh: async () => {},
    editConfig: async () => true,
    setRefresher: async () => true,
    ...overrides
  }
}
