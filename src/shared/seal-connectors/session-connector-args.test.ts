import { describe, expect, it } from 'vitest'
import {
  claudeConnectorArgs,
  codexConnectorArgs,
  type SessionConnectorPlan
} from './session-connector-args'

const REAL_KEY = 'k3y-that-must-never-reach-an-argument'

const plan: SessionConnectorPlan = {
  env: { SEAL_CONNECTOR_KEY: REAL_KEY, SEAL_CONNECTOR_DB_TOKEN: 'secret-db-token' },
  servers: [
    {
      name: 'slack',
      type: 'http',
      url: 'http://127.0.0.1:4100/c/slack',
      relay: true,
      disabledTools: ['delete_message']
    },
    {
      name: 'codegraph',
      type: 'stdio',
      command: 'codegraph',
      args: ['serve', '--mcp'],
      env: { MODE: 'fast' },
      secretEnv: {},
      disabledTools: []
    },
    {
      name: 'db',
      type: 'stdio',
      command: 'dbmcp',
      args: [],
      env: {},
      secretEnv: { TOKEN: 'SEAL_CONNECTOR_DB_TOKEN' },
      disabledTools: []
    }
  ],
  pluginDirs: ['/lib/plugins/notes', '/lib/skills'],
  disallowedTools: ['mcp__slack__delete_message']
}

describe('claudeConnectorArgs', () => {
  it('renders strict mcp config, the disabled tools and plugin dirs', () => {
    expect(claudeConnectorArgs(plan)).toEqual([
      '--mcp-config',
      '{"mcpServers":{"slack":{"type":"http","url":"http://127.0.0.1:4100/c/slack","headers":{"Authorization":"Bearer ${SEAL_CONNECTOR_KEY}"}},"codegraph":{"type":"stdio","command":"codegraph","args":["serve","--mcp"],"env":{"MODE":"fast"}},"db":{"type":"stdio","command":"dbmcp","args":[],"env":{"TOKEN":"${SEAL_CONNECTOR_DB_TOKEN}"}}}}',
      '--disallowedTools',
      'mcp__slack__delete_message',
      '--strict-mcp-config',
      '--plugin-dir',
      '/lib/plugins/notes',
      '--plugin-dir',
      '/lib/skills'
    ])
  })

  it('still goes strict with no servers', () => {
    expect(
      claudeConnectorArgs({ env: {}, servers: [], pluginDirs: [], disallowedTools: [] })
    ).toEqual(['--strict-mcp-config'])
  })

  it('never puts a secret value in the args', () => {
    const rendered = JSON.stringify(claudeConnectorArgs(plan))
    expect(rendered).not.toContain(REAL_KEY)
    expect(rendered).not.toContain('secret-db-token')
  })
})

describe('codexConnectorArgs', () => {
  it('turns off config servers the plan leaves out and spells out planned ones', () => {
    expect(codexConnectorArgs(plan, ['codegraph', 'old-server', 'odd.name'])).toEqual([
      '-c',
      'mcp_servers.old-server.enabled=false',
      '-c',
      'mcp_servers.slack.url="http://127.0.0.1:4100/c/slack"',
      '-c',
      'mcp_servers.slack.bearer_token_env_var="SEAL_CONNECTOR_KEY"',
      '-c',
      'mcp_servers.slack.enabled=true',
      '-c',
      'mcp_servers.slack.disabled_tools=["delete_message"]',
      '-c',
      'mcp_servers.codegraph.command="codegraph"',
      '-c',
      'mcp_servers.codegraph.args=["serve","--mcp"]',
      '-c',
      'mcp_servers.codegraph.env.MODE="fast"',
      '-c',
      'mcp_servers.codegraph.enabled=true',
      '-c',
      'mcp_servers.db.command="sh"',
      '-c',
      'mcp_servers.db.args=["-c","TOKEN=\\"${SEAL_CONNECTOR_DB_TOKEN}\\" exec \\"$@\\"","sh","dbmcp"]',
      '-c',
      'mcp_servers.db.env_vars=["SEAL_CONNECTOR_DB_TOKEN"]',
      '-c',
      'mcp_servers.db.enabled=true'
    ])
  })

  it('never puts a secret value in the args', () => {
    const rendered = JSON.stringify(codexConnectorArgs(plan, []))
    expect(rendered).not.toContain(REAL_KEY)
    expect(rendered).not.toContain('secret-db-token')
  })
})
