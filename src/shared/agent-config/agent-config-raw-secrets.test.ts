import { describe, expect, it } from 'vitest'
import { maskRawConfigText, unmaskRawConfigText } from './agent-config-raw-secrets'

const JSON_FILE = `{
  // kept
  "userID": "u-1",
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "docs-mcp", "--api-key=sk-live-abcdef0123456789"],
      "env": { "DOCS_TOKEN": "docs-secret-1", "REGION": "eu" }
    },
    "db": { "url": "https://user:hunter2@db.example/mcp?mode=ro" }
  }
}
`

const TOML_FILE = `# Codex settings
model = "gpt-5" # the default

[mcp_servers.docs]
command = "npx"
args = ["-y", "docs-mcp"]

[mcp_servers.docs.env]
DOCS_TOKEN = "codex-secret-4"
`

describe('raw config text with secrets hidden', () => {
  it('masks only the secret values of a JSON file', () => {
    expect(maskRawConfigText('json', JSON_FILE)).toBe(`{
  // kept
  "userID": "u-1",
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "docs-mcp", "••••••••"],
      "env": { "DOCS_TOKEN": "••••••••", "REGION": "eu" }
    },
    "db": { "url": "https://user:••••••••@db.example/mcp?mode=ro" }
  }
}
`)
  })

  it('masks only the secret values of a TOML file', () => {
    expect(maskRawConfigText('toml', TOML_FILE)).toBe(
      TOML_FILE.replace('codex-secret-4', '••••••••')
    )
  })

  it('puts stored secrets back under an edit made around them', () => {
    const edited = maskRawConfigText('json', JSON_FILE).replace('"eu"', '"us"')
    expect(unmaskRawConfigText('json', edited, JSON_FILE)).toBe(JSON_FILE.replace('"eu"', '"us"'))
    const toml = maskRawConfigText('toml', TOML_FILE).replace('gpt-5', 'gpt-5-codex')
    expect(unmaskRawConfigText('toml', toml, TOML_FILE)).toBe(
      TOML_FILE.replace('gpt-5', 'gpt-5-codex')
    )
  })

  it('keeps a secret that was typed over, and refuses a mask it cannot place', () => {
    const masked = maskRawConfigText('json', JSON_FILE)
    const retyped = masked.replace('"DOCS_TOKEN": "••••••••"', '"DOCS_TOKEN": "new-token"')
    expect(unmaskRawConfigText('json', retyped, JSON_FILE)).toContain('"DOCS_TOKEN": "new-token"')

    const renamed = masked.replace('"DOCS_TOKEN"', '"DOCS_KEY"')
    expect(() => unmaskRawConfigText('json', renamed, JSON_FILE)).toThrow(
      'Enter the value of mcpServers.docs.env.DOCS_KEY again'
    )
    const shortened = masked.replace('"-y", ', '')
    expect(() => unmaskRawConfigText('json', shortened, JSON_FILE)).toThrow(
      'Enter the value of mcpServers.docs.args.1 again'
    )
  })
})
