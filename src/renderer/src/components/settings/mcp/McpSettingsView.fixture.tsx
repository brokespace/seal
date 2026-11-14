import { defineFixture } from '../../../component-fixtures/component-fixture'
import type {
  SealMcpApprovalRequest,
  SealMcpAuditEntry,
  SealMcpClient,
  SealMcpMachine,
  SealMcpStatus
} from '../../../../../shared/seal-mcp/seal-mcp-types'
import { SettingsGroup } from '../section-layout/SettingsGroup'
import { McpAuditLogView } from './McpAuditLog'
import { McpClientCreateDialog } from './McpClientCreateDialog'
import { McpConnectClient } from './McpConnectClient'
import { McpSettingsView, type McpSettingsActions } from './McpSettingsView'
import { McpTokenRevealDialog } from './McpTokenRevealDialog'
import type { SealMcpLoad } from './use-seal-mcp'

const NOW = Date.UTC(2026, 10, 13, 18, 0)
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

const status: SealMcpStatus = {
  settings: { httpEnabled: true, relayEnabled: true },
  httpUrls: ['http://192.168.1.24:6768/mcp', 'http://100.84.12.7:6768/mcp'],
  relayUrl: 'https://relay.seal.example/mcp/h_4f2a9c1e',
  relayConnected: true,
  toolCount: 24
}

const machines: SealMcpMachine[] = [
  { id: 'local', label: 'This computer' },
  { id: 'ssh:build-box', label: 'build-box (SSH)' },
  { id: 'env:studio', label: 'Studio Mac' }
]

const clients: SealMcpClient[] = [
  {
    id: 'c1',
    name: 'Claude Code on my laptop',
    scopes: ['read', 'sessions', 'files', 'commands'],
    machines: null,
    approval: 'destructive',
    allowRelay: false,
    callsPerMinute: 120,
    createdAt: NOW - 12 * DAY,
    lastUsedAt: NOW - 4 * MINUTE,
    revokedAt: null
  },
  {
    id: 'c2',
    name: 'Cursor (travel)',
    scopes: ['read', 'sessions'],
    machines: ['ssh:build-box', 'env:studio'],
    approval: 'commands',
    allowRelay: true,
    callsPerMinute: 60,
    createdAt: NOW - 3 * DAY,
    lastUsedAt: null,
    revokedAt: null
  },
  {
    id: 'c3',
    name: 'Old CI script',
    scopes: ['read', 'commands', 'destructive'],
    machines: ['ssh:build-box'],
    approval: 'never',
    allowRelay: false,
    callsPerMinute: 600,
    createdAt: NOW - 90 * DAY,
    lastUsedAt: NOW - 40 * DAY,
    revokedAt: NOW - 30 * DAY
  }
]

function entry(
  overrides: Partial<SealMcpAuditEntry> & Pick<SealMcpAuditEntry, 'id'>
): SealMcpAuditEntry {
  return {
    at: NOW,
    clientId: 'c1',
    clientName: 'Claude Code on my laptop',
    transport: 'stdio',
    remote: 'local',
    method: 'tools/call',
    tool: null,
    machine: null,
    summary: null,
    outcome: 'ok',
    approved: null,
    durationMs: 12,
    detail: null,
    ...overrides
  }
}

const auditEntries: SealMcpAuditEntry[] = [
  entry({
    id: 'a1',
    at: NOW - 1 * MINUTE,
    tool: 'run_command',
    machine: 'build-box (SSH)',
    summary: '{"command":"pnpm test --maxWorkers=2","cwd":"/srv/acme/web"}',
    approved: true
  }),
  entry({ id: 'a2', at: NOW - 2 * MINUTE, tool: 'list_sessions' }),
  entry({
    id: 'a3',
    at: NOW - 9 * MINUTE,
    clientId: 'c2',
    clientName: 'Cursor (travel)',
    transport: 'relay',
    remote: '203.0.113.40',
    tool: 'write_file',
    machine: 'Studio Mac',
    summary: '{"path":"/Users/sam/notes.md","content":"(412 bytes)"}',
    outcome: 'scope-denied',
    detail: 'This client lacks the files scope.'
  }),
  entry({
    id: 'a4',
    at: NOW - 15 * MINUTE,
    tool: 'delete_workspace',
    machine: 'This computer',
    summary: '{"workspace":"acme-web/fix-login"}',
    outcome: 'approval-denied',
    approved: false,
    detail: 'Declined in the Seal app.'
  }),
  entry({
    id: 'a5',
    at: NOW - 31 * MINUTE,
    clientId: null,
    clientName: null,
    transport: 'http',
    remote: '192.168.1.77',
    method: 'initialize',
    outcome: 'unauthorized',
    detail: 'No valid token.'
  }),
  entry({
    id: 'a6',
    at: NOW - 42 * MINUTE,
    tool: 'read_file',
    machine: 'build-box (SSH)',
    summary: '{"path":"/srv/acme/web/missing.ts"}',
    outcome: 'error',
    detail: 'ENOENT: no such file or directory'
  })
]

const pending: SealMcpApprovalRequest = {
  id: 'p1',
  clientId: 'c2',
  clientName: 'Cursor (travel)',
  transport: 'relay',
  tool: 'run_command',
  machine: 'Studio Mac',
  summary: '{"command":"git push origin main","cwd":"/Users/sam/acme/web"}',
  reason: 'This client asks before every command.',
  requestedAt: Date.now(),
  expiresAt: Date.now() + 96_000
}

const actions: McpSettingsActions = {
  retry: () => {},
  updateSettings: () => {},
  addClient: () => {},
  revokeClient: () => {},
  removeClient: () => {},
  respondApproval: () => {}
}

const ready: SealMcpLoad = { phase: 'ready', snapshot: { status, clients }, readAt: NOW }

const audit = (
  <McpAuditLogView
    clients={clients}
    clientId={null}
    onClientIdChange={() => {}}
    state={{
      entries: auditEntries,
      phase: 'ready',
      error: null,
      hasOlder: true,
      loadingOlder: false
    }}
    onLoadOlder={() => {}}
  />
)

function view(overrides: Partial<React.ComponentProps<typeof McpSettingsView>>) {
  return (
    <McpSettingsView
      hostName={null}
      environment={null}
      load={ready}
      machines={machines}
      approvals={[]}
      answering={null}
      busy={false}
      actions={actions}
      audit={audit}
      {...overrides}
    />
  )
}

export const page = defineFixture({ width: 760, render: () => view({}) })

// A paired server with a call waiting, and nothing configured yet.
export const pairedServerFirstRun = defineFixture({
  width: 760,
  render: () =>
    view({
      hostName: 'Studio Mac',
      environment: 'env-studio',
      approvals: [pending],
      load: {
        phase: 'ready',
        readAt: NOW,
        snapshot: {
          status: {
            settings: { httpEnabled: true, relayEnabled: false },
            httpUrls: [],
            relayUrl: null,
            relayConnected: false,
            toolCount: 24
          },
          clients: []
        }
      },
      audit: (
        <McpAuditLogView
          clients={[]}
          clientId={null}
          onClientIdChange={() => {}}
          state={{ entries: [], phase: 'ready', error: null, hasOlder: false, loadingOlder: false }}
          onLoadOlder={() => {}}
        />
      )
    })
})

// The page is taller than the fixture viewport; these show the groups below the clients.
export const connectClient = defineFixture({
  width: 760,
  render: () => (
    <SettingsGroup title="Connect a client">
      <div className="py-3" data-settings-row="">
        <McpConnectClient status={status} environment="env-studio" />
      </div>
    </SettingsGroup>
  )
})

export const auditLog = defineFixture({
  width: 760,
  render: () => <SettingsGroup title="Audit log">{audit}</SettingsGroup>
})

export const olderServer = defineFixture({
  width: 760,
  render: () => view({ hostName: 'build-box', load: { phase: 'unsupported' } })
})

export const loadFailed = defineFixture({
  width: 760,
  render: () =>
    view({ load: { phase: 'error', message: 'The Seal server did not answer in 30 seconds.' } })
})

export const addClient = defineFixture({
  width: 760,
  render: () => (
    <div className="h-[860px]">
      <McpClientCreateDialog
        open
        onOpenChange={() => {}}
        machines={machines}
        onCreate={async () => false}
      />
    </div>
  )
})

export const tokenReveal = defineFixture({
  width: 900,
  render: () => (
    <div className="h-[900px]">
      <McpTokenRevealDialog
        created={{
          client: clients[0],
          token: 'smcp_0123456789ab_EXAMPLEexampleEXAMPLEexampleEXAMPLEexample0'
        }}
        status={status}
        environment={null}
        onClose={() => {}}
      />
    </div>
  )
})
