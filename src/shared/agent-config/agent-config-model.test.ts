import { describe, expect, it } from 'vitest'
import { effectiveConfig } from './agent-config-effective'
import { setFrontmatterFields, validateMarkdownDocument } from './agent-config-frontmatter'
import { editJsonText } from './agent-config-json-edit'
import {
  convertMcpEntry,
  listMcpServers,
  markShadowedServers,
  mcpSaveEdits,
  type McpServersLocation
} from './agent-config-mcp-servers'
import { buildPluginsState } from './agent-config-plugins-state'
import { maskConfigValue } from './agent-config-secrets'
import { editTomlText } from './agent-config-toml-edit'
import { AGENT_CONFIG_SECRET_MASK as MASK, type AgentConfigMcpDraft } from './agent-config-types'
import { validateAgentConfigContent } from './agent-config-validation'

const CLAUDE_JSON = `{
  "userID": "u-1",
  "mcpServers": {
    "docs": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "docs-mcp", "--api-key", "sk-live-abcdef1234567890"],
      "env": { "DOCS_TOKEN": "abc", "REGION": "eu" },
      "timeout": 9000
    },
    "sentry": {
      "type": "http",
      "url": "https://mcp.sentry.dev/mcp?token=q1w2e3",
      "headers": { "Authorization": "Bearer zzz", "X-Team": "seal" },
      "oauth": { "clientId": "cid" }
    }
  }
}
`

const USER: McpServersLocation = {
  scope: 'user',
  sourcePath: '/home/u/.claude.json',
  codec: 'claude',
  serversPath: ['mcpServers']
}

function draftOf(server: ReturnType<typeof listMcpServers>[number]): AgentConfigMcpDraft {
  const { name, transport, command, args, env, url, headers, enabled } = server
  return { name, transport, command, args, env, url, headers, enabled }
}

describe('MCP servers', () => {
  const config: { mcpServers: object } = JSON.parse(CLAUDE_JSON)

  it('lists servers with every secret masked and says which fields are', () => {
    const [docs, sentry] = listMcpServers(config, USER)

    expect(docs).toMatchObject({
      name: 'docs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'docs-mcp', '--api-key', MASK],
      env: { DOCS_TOKEN: MASK, REGION: 'eu' },
      maskedFields: ['env.DOCS_TOKEN', 'args.3'],
      extraKeys: ['timeout']
    })
    expect(sentry).toMatchObject({
      transport: 'http',
      url: `https://mcp.sentry.dev/mcp?token=${MASK}`,
      headers: { Authorization: MASK, 'X-Team': 'seal' },
      maskedFields: ['headers.Authorization', 'url'],
      extraKeys: ['oauth']
    })
    expect(JSON.stringify([docs, sentry])).not.toMatch(/abc|zzz|q1w2e3|sk-live/)
  })

  it('saving a form that still shows masks keeps the stored secrets and unknown keys', () => {
    const [docs] = listMcpServers(config, USER)
    const edits = mcpSaveEdits(
      config,
      USER,
      { ...draftOf(docs), env: { ...docs.env, REGION: 'us' } },
      'docs'
    )
    const saved: unknown = JSON.parse(editJsonText(CLAUDE_JSON, edits))

    expect(edits).toEqual([
      { path: ['mcpServers', 'docs', 'env'], value: { DOCS_TOKEN: 'abc', REGION: 'us' } }
    ])
    expect(saved).toEqual({
      ...config,
      mcpServers: {
        ...config.mcpServers,
        docs: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'docs-mcp', '--api-key', 'sk-live-abcdef1234567890'],
          env: { DOCS_TOKEN: 'abc', REGION: 'us' },
          timeout: 9000
        }
      }
    })
  })

  it('switching a server to HTTP drops the command fields and keeps what Seal does not edit', () => {
    const [docs] = listMcpServers(config, USER)
    const edits = mcpSaveEdits(
      config,
      USER,
      { ...draftOf(docs), name: 'docs-remote', transport: 'http', url: 'https://d.example/mcp' },
      'docs'
    )

    expect(edits).toEqual([
      { path: ['mcpServers', 'docs'], remove: true },
      {
        path: ['mcpServers', 'docs-remote'],
        value: { type: 'http', timeout: 9000, url: 'https://d.example/mcp' }
      }
    ])
  })

  it('refuses a masked value it cannot match, a clashing name and an unusable server', () => {
    const [docs, sentry] = listMcpServers(config, USER)

    expect(() =>
      mcpSaveEdits(config, USER, { ...draftOf(docs), env: { NEW_TOKEN: MASK } }, 'docs')
    ).toThrow(/Enter the value of variable "NEW_TOKEN" again/)
    expect(() =>
      mcpSaveEdits(config, USER, { ...draftOf(sentry), name: 'docs' }, 'sentry')
    ).toThrow(/already a server named "docs"/)
    expect(() => mcpSaveEdits(config, USER, { ...draftOf(docs), command: ' ' }, 'docs')).toThrow(
      /command that starts the server/
    )
  })

  it('writes Codex servers as TOML tables and converts between agents', () => {
    const codex: McpServersLocation = {
      scope: 'user',
      sourcePath: '/home/u/.codex/config.toml',
      codec: 'codex',
      serversPath: ['mcp_servers']
    }
    const toml = 'model = "gpt-5"\n\n[mcp_servers.old]\ncommand = "node"\ntool_timeout_sec = 30\n'
    const parsed = {
      model: 'gpt-5',
      mcp_servers: { old: { command: 'node', tool_timeout_sec: 30 } }
    }
    const edits = mcpSaveEdits(
      parsed,
      codex,
      {
        name: 'old',
        transport: 'http',
        command: '',
        args: [],
        env: {},
        url: 'https://c.example/mcp',
        headers: { 'X-Key': 'k' },
        enabled: false
      },
      'old'
    )

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a server draft holds only strings, booleans, lists and maps of strings.
    expect(editTomlText(toml, edits as Parameters<typeof editTomlText>[1])).toBe(
      'model = "gpt-5"\n\n[mcp_servers.old]\ntool_timeout_sec = 30\nurl = "https://c.example/mcp"\nhttp_headers = { X-Key = "k" }\nenabled = false\n'
    )
    expect(
      convertMcpEntry(
        { type: 'sse', url: 'https://s.example/sse', headers: { A: 'b' } },
        'claude',
        'codex'
      )
    ).toEqual({ url: 'https://s.example/sse', http_headers: { A: 'b' } })
    expect(
      convertMcpEntry({ command: 'npx', args: ['-y', 'x'], env: { K: 'v' } }, 'claude', 'opencode')
    ).toEqual({ type: 'local', command: ['npx', '-y', 'x'], environment: { K: 'v' } })
  })

  it('marks the server a stronger scope replaces', () => {
    const project = listMcpServers(
      { mcpServers: { docs: { command: 'uvx' } } },
      { ...USER, scope: 'project' }
    )
    const marked = markShadowedServers([...listMcpServers(config, USER), ...project])

    expect(marked.map((server) => [server.name, server.scope, server.shadowedBy])).toEqual([
      ['docs', 'user', 'project'],
      ['sentry', 'user', undefined],
      ['docs', 'project', undefined]
    ])
  })
})

describe('effective config', () => {
  it('adds lists up, lets the stronger scope win, and says where each value comes from', () => {
    const entries = effectiveConfig(
      [
        {
          scope: 'user',
          value: {
            model: 'sonnet',
            permissions: { allow: ['Read', 'Bash(ls:*)'] },
            env: { A: '1' }
          }
        },
        {
          scope: 'project',
          value: { model: 'opus', permissions: { allow: ['Read', 'Edit'], deny: ['WebFetch'] } }
        },
        { scope: 'local', value: { env: { A: '2' } } }
      ],
      { mergeLists: true }
    )

    expect(entries).toEqual([
      {
        key: 'env.A',
        value: '"2"',
        source: 'local',
        overrides: [{ source: 'user', value: '"1"' }]
      },
      {
        key: 'model',
        value: '"opus"',
        source: 'project',
        overrides: [{ source: 'user', value: '"sonnet"' }]
      },
      {
        key: 'permissions.allow',
        value: '["Read","Bash(ls:*)","Edit"]',
        source: 'project',
        items: [
          { value: '"Read"', source: 'user' },
          { value: '"Bash(ls:*)"', source: 'user' },
          { value: '"Edit"', source: 'project' }
        ],
        overrides: []
      },
      {
        key: 'permissions.deny',
        value: '["WebFetch"]',
        source: 'project',
        items: [{ value: '"WebFetch"', source: 'project' }],
        overrides: []
      }
    ])
  })
})

describe('plugins', () => {
  it('reads installs, marketplaces and which scope switched a plugin on or off', () => {
    const state = buildPluginsState({
      installed: {
        version: 2,
        plugins: {
          'hello@local-mkt': [
            { scope: 'user', installPath: '/h/cache/hello/1.0.0', version: '1.0.0' }
          ],
          'other@local-mkt': [
            {
              scope: 'project',
              installPath: '/h/cache/other/1.0.0',
              version: '1.0.0',
              projectPath: '/p'
            }
          ]
        }
      },
      marketplaces: {
        'local-mkt': { source: { source: 'github', repo: 'acme/plugins' }, installLocation: '/h/m' }
      },
      manifests: {
        'local-mkt': {
          plugins: [
            { name: 'hello', description: 'Says hello', version: '1.0.0' },
            { name: 'spare', description: 'Not installed' }
          ]
        }
      },
      settings: [
        { scope: 'user', value: { enabledPlugins: { 'hello@local-mkt': true } } },
        { scope: 'project', value: { enabledPlugins: { 'other@local-mkt': true } } },
        { scope: 'local', value: { enabledPlugins: { 'hello@local-mkt': false } } }
      ],
      projectPath: '/p'
    })

    expect(state.plugins).toMatchObject([
      {
        id: 'hello@local-mkt',
        description: 'Says hello',
        enabled: false,
        enabledBy: 'local',
        enabledIn: { user: true, local: false }
      },
      {
        id: 'other@local-mkt',
        name: 'other',
        marketplace: 'local-mkt',
        enabled: true,
        enabledBy: 'project'
      }
    ])
    expect(state.marketplaces).toEqual([
      {
        name: 'local-mkt',
        source: 'acme/plugins',
        installLocation: '/h/m',
        plugins: [
          { name: 'hello', description: 'Says hello', version: '1.0.0', installed: true },
          { name: 'spare', description: 'Not installed', version: null, installed: false }
        ]
      }
    ])
  })
})

describe('documents and files', () => {
  const SKILL = `---
# how the agent finds it
name: deploy-app
description: Deploys the app.
license: MIT
---

# Deploy
`

  it('validates SKILL.md front matter', () => {
    const messages = (content: string, folder?: string): string[] =>
      validateMarkdownDocument('skill', content, folder).map(
        (item) => `${item.severity}: ${item.field}`
      )

    expect(messages(SKILL, 'deploy-app')).toEqual([])
    expect(messages(SKILL, 'deploy')).toEqual(['warning: name'])
    expect(messages('# Deploy\n')).toEqual(['error: undefined'])
    expect(messages('---\nname: Deploy App\n---\nbody\n')).toEqual([
      'error: name',
      'error: description'
    ])
    expect(messages('---\nname: a\ndescription: use when: broken\n---\nbody\n')).toEqual([
      'error: undefined'
    ])
    expect(messages(`---\nname: a\ndescription: ${'x'.repeat(1025)}\n---\nbody\n`)).toEqual([
      'error: description'
    ])
  })

  it('renames in front matter without touching comments or unknown fields', () => {
    expect(setFrontmatterFields(SKILL, { name: 'deploy-app-copy' })).toBe(
      SKILL.replace('name: deploy-app', 'name: deploy-app-copy')
    )
  })

  it('stops settings and config files that the agent could not read', () => {
    const errors = (
      kind: Parameters<typeof validateAgentConfigContent>[0],
      content: string
    ): string[] =>
      validateAgentConfigContent(kind, content)
        .filter((item) => item.severity === 'error')
        .map((item) => item.field ?? item.message)

    expect(
      errors(
        'claude-settings',
        '{ "permissions": { "allow": "Read" }, "env": { "A": 1 }, "hooks": { "Stop": [{}] } }'
      )
    ).toEqual(['permissions.allow', 'env', 'hooks.Stop'])
    expect(
      errors('claude-settings', '{ "permissions": { "allow": ["Read"] }, "futureKey": [1] }')
    ).toEqual([])
    expect(errors('mcp-json', '{ "mcpServers": { "a": {} } }')).toEqual(['mcpServers.a'])
    expect(errors('json', '{ "a": 1, }')).toHaveLength(1)
    expect(
      errors('codex-config', 'model = "x"\n[mcp_servers.a]\nstartup_timeout_sec = 1\n')
    ).toEqual(['mcp_servers.a'])
    expect(errors('codex-config', 'model = ')).toHaveLength(1)
  })

  it('masks secrets in settings without hiding ordinary values', () => {
    const masked = maskConfigValue({
      env: { ANTHROPIC_API_KEY: 'k-1', EDITOR: 'vim' },
      preferred_auth_method: 'chatgpt',
      bearer_token_env_var: 'EX_TOKEN',
      model_providers: { x: { experimental_bearer_token: 'tok', base_url: 'https://x' } },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'curl -H ghp_abcdefghijklmnop' }] }] }
    })

    expect(masked).toEqual({
      value: {
        env: { ANTHROPIC_API_KEY: MASK, EDITOR: 'vim' },
        preferred_auth_method: 'chatgpt',
        bearer_token_env_var: 'EX_TOKEN',
        model_providers: { x: { experimental_bearer_token: MASK, base_url: 'https://x' } },
        hooks: { Stop: [{ hooks: [{ type: 'command', command: MASK }] }] }
      },
      maskedPaths: [
        'env.ANTHROPIC_API_KEY',
        'model_providers.x.experimental_bearer_token',
        'hooks.Stop.0.hooks.0.command'
      ]
    })
  })
})
