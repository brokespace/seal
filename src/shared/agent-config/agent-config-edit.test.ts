import { describe, expect, it } from 'vitest'
import { editJsonText } from './agent-config-json-edit'
import { editTomlText } from './agent-config-toml-edit'

const CODEX = `# Codex settings
model = "gpt-5" # the default
approval_policy = "on-request"

# Servers
[mcp_servers.docs]
command = "npx"
args = ["-y", "docs-mcp"] # keep
env = { DOCS_TOKEN = "abc", REGION = "eu" }
startup_timeout_sec = 20

[mcp_servers.search]
url = "https://search.example/mcp"

[mcp_servers.search.http_headers]
Authorization = "Bearer one"

[profiles.fast]
model = "gpt-5-mini"

[[notify]]
program = "say"
`

describe('editTomlText', () => {
  it('changes one key and keeps comments, order and unknown keys', () => {
    const next = editTomlText(CODEX, [{ path: ['model'], value: 'gpt-5.1' }])

    expect(next).toBe(
      CODEX.replace('model = "gpt-5" # the default', 'model = "gpt-5.1" # the default')
    )
  })

  it('edits inside a table without touching its neighbours', () => {
    const next = editTomlText(CODEX, [
      { path: ['mcp_servers', 'docs', 'command'], value: 'uvx' },
      { path: ['mcp_servers', 'docs', 'env', 'REGION'], value: 'us' },
      { path: ['mcp_servers', 'docs', 'enabled'], value: false }
    ])

    expect(next).toContain('command = "uvx"\nargs = ["-y", "docs-mcp"] # keep\n')
    expect(next).toContain('env = { DOCS_TOKEN = "abc", REGION = "us" }')
    expect(next).toContain('startup_timeout_sec = 20\nenabled = false\n\n[mcp_servers.search]')
    expect(next).toContain('# Servers\n[mcp_servers.docs]')
  })

  it('adds a table at the end and a root key under the opening comment', () => {
    const next = editTomlText('# mine\n\n[profiles.fast]\nmodel = "m"\n', [
      { path: ['sandbox_mode'], value: 'workspace-write' },
      {
        path: ['mcp_servers', 'new one'],
        value: { command: 'node', args: ['s.js'], env: { K: 'v' } }
      }
    ])

    expect(next).toBe(
      '# mine\nsandbox_mode = "workspace-write"\n\n[profiles.fast]\nmodel = "m"\n\n' +
        '[mcp_servers."new one"]\ncommand = "node"\nargs = [ "s.js" ]\n\n[mcp_servers."new one".env]\nK = "v"\n'
    )
  })

  it('removes a server with its sub-tables and nothing else', () => {
    const next = editTomlText(CODEX, [{ path: ['mcp_servers', 'search'], remove: true }])

    expect(next).not.toContain('search')
    expect(next).toContain(
      'startup_timeout_sec = 20\n\n[profiles.fast]\nmodel = "gpt-5-mini"\n\n[[notify]]'
    )
  })

  it('replaces a sub-table where it stood', () => {
    const next = editTomlText(CODEX, [
      { path: ['mcp_servers', 'search', 'http_headers'], value: { 'X-Key': 'two' } }
    ])

    expect(next).toContain(
      '[mcp_servers.search]\nurl = "https://search.example/mcp"\n\n[mcp_servers.search.http_headers]\nX-Key = "two"\n\n[profiles.fast]'
    )
  })

  it('refuses to edit inside an array of tables or an invalid file', () => {
    expect(() => editTomlText(CODEX, [{ path: ['notify', 'program'], value: 'x' }])).toThrow(
      /raw editor/
    )
    expect(() => editTomlText('model = ', [{ path: ['model'], value: 'x' }])).toThrow(
      /not valid TOML/
    )
  })
})

describe('editJsonText', () => {
  const SETTINGS = `{
  // who may do what
  "permissions": {
    "allow": ["Bash(ls:*)"],
    "futureField": 1
  },
  "env": {
    "A": "1"
  },
  "someNewClaudeFeature": { "x": [1, 2] },
  "model": "sonnet"
}
`

  it('changes only the named paths', () => {
    const next = editJsonText(SETTINGS, [
      { path: ['permissions', 'deny'], value: ['Read(./.env)'] },
      { path: ['env', 'B'], value: '2' },
      { path: ['env', 'A'], remove: true },
      { path: ['model'], value: 'opus' }
    ])

    expect(next).toBe(`{
  // who may do what
  "permissions": {
    "allow": ["Bash(ls:*)"],
    "futureField": 1,
    "deny": [
      "Read(./.env)"
    ]
  },
  "env": {
    "B": "2"
  },
  "someNewClaudeFeature": { "x": [1, 2] },
  "model": "opus"
}
`)
  })

  it('starts an empty file and refuses a broken one', () => {
    expect(
      JSON.parse(editJsonText('', [{ path: ['mcpServers', 'a'], value: { command: 'x' } }]))
    ).toEqual({ mcpServers: { a: { command: 'x' } } })
    expect(() => editJsonText('{ "a": ', [{ path: ['a'], value: 1 }])).toThrow(/not valid JSON/)
  })
})
