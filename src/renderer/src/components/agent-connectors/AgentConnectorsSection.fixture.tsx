import { defineFixture } from '../../component-fixtures/component-fixture'
import type {
  AgentConnector,
  AgentConnectorsSnapshot
} from '../../../../shared/agent-connectors/agent-connector-types'
import { AgentConnectorsSection } from './AgentConnectorsSection'

const atlassian: AgentConnector[] = [
  {
    name: 'claude.ai Atlassian',
    kind: 'claude-ai',
    transport: 'http',
    target: 'https://mcp.atlassian.com/v1/sse',
    status: 'needs-auth',
    detail: null
  },
  {
    name: 'claude.ai Atlassian (2)',
    kind: 'claude-ai',
    transport: 'http',
    target: 'https://mcp.atlassian.com/v1/mcp',
    status: 'needs-auth',
    detail: null
  },
  {
    name: 'plugin:atlassian:atlassian',
    kind: 'plugin',
    transport: 'http',
    target: 'https://mcp.atlassian.com/v1/mcp',
    status: 'connected',
    detail: null
  }
]

const snapshot: AgentConnectorsSnapshot = {
  machineId: 'local',
  checkedAt: Date.UTC(2026, 10, 19, 14, 30),
  accounts: [
    {
      id: 'claude:default',
      agent: 'claude',
      label: 'Work',
      email: 'dev@example.com',
      isDefault: true,
      connectors: [
        ...atlassian,
        {
          name: 'codegraph',
          kind: 'user',
          transport: 'stdio',
          target: 'codegraph serve --mcp',
          status: 'connected',
          detail: null
        },
        {
          name: 'broken',
          kind: 'project',
          transport: 'stdio',
          target: '/opt/tool --token ••••',
          status: 'failed',
          detail: 'Failed to connect — ENOENT'
        }
      ],
      duplicates: [
        {
          service: 'atlassian.com',
          names: atlassian.map((connector) => connector.name),
          keep: 'plugin:atlassian:atlassian',
          reason: 'connected'
        }
      ],
      claudeAiConnectorsDisabled: false,
      error: null,
      checkedAt: 0
    },
    {
      id: 'claude:profile',
      agent: 'claude',
      label: 'Personal',
      email: 'me@example.com',
      isDefault: false,
      connectors: [
        {
          name: 'plugin:slack:slack',
          kind: 'plugin',
          transport: 'http',
          target: 'https://mcp.slack.com/mcp',
          status: 'needs-auth',
          detail: null
        }
      ],
      duplicates: [],
      claudeAiConnectorsDisabled: true,
      error: null,
      checkedAt: 0
    }
  ]
}

function installApi(): void {
  Object.assign(window.api, {
    agentConnectors: {
      list: async ({ machineId }: { machineId: AgentConnectorsSnapshot['machineId'] }) => ({
        ...snapshot,
        machineId
      }),
      signInStart: async () => ({
        kind: 'url',
        sessionId: 'fixture',
        url: 'https://mcp.slack.com/oauth/authorize?client_id=fixture'
      }),
      signInSubmit: async () => null,
      // The CLI is still waiting on the browser.
      signInWait: () => new Promise(() => {}),
      signInCancel: async () => {}
    }
  })
}

export const accounts = defineFixture({
  width: 720,
  setup: installApi,
  render: () => <AgentConnectorsSection machineId="local" machineLabel="This computer" />
})

/** A remote machine's sign-in: the browser cannot reach its localhost, so the address is pasted. */
export const remoteSignIn = defineFixture({
  width: 720,
  setup: installApi,
  render: () => <AgentConnectorsSection machineId="machine:build-box" machineLabel="build-box" />,
  interact: async (frame) => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    frame.querySelector<HTMLElement>('[data-agent-connector="plugin:slack:slack"] button')?.click()
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
})
