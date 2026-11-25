import { describe, expect, it } from 'vitest'
import { findAuthorizeUrl, parseClaudeMcpList, sanitizeConnectorCommand } from './mcp-cli-output'

const LIST = [
  'Checking MCP server health…',
  '',
  '[mcp-sdk] warning: something - ! odd',
  'claude.ai Atlassian: https://mcp.atlassian.com/v1/sse?ref=x (SSE) - ! Needs authentication',
  'claude.ai Atlassian (2): https://mcp.atlassian.com/v1/mcp (HTTP) - ! Needs authentication',
  'claude.ai Atlassian MCP: https://mcp.atlassian.com/v1/mcp (HTTP) - ! Needs authentication',
  '\u001b[32mplugin:atlassian:atlassian: https://mcp.atlassian.com/v1/mcp (HTTP) - ✔ Connected\u001b[39m',
  'plugin:slack:slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication',
  'codegraph: codegraph serve --mcp - ✔ Connected',
  "broken: /nonexistent/bin --token abc123 - ✘ Failed to connect — ENOENT: posix_spawn '/nonexistent/bin'"
].join('\n')

describe('parseClaudeMcpList', () => {
  it('reads every server line with its kind, status and a secret-free target', () => {
    const connectors = parseClaudeMcpList(LIST, new Set(['codegraph']))
    expect(
      connectors.map(({ name, kind, status, target }) => [name, kind, status, target])
    ).toEqual([
      ['claude.ai Atlassian', 'claude-ai', 'needs-auth', 'https://mcp.atlassian.com/v1/sse'],
      ['claude.ai Atlassian (2)', 'claude-ai', 'needs-auth', 'https://mcp.atlassian.com/v1/mcp'],
      ['claude.ai Atlassian MCP', 'claude-ai', 'needs-auth', 'https://mcp.atlassian.com/v1/mcp'],
      ['plugin:atlassian:atlassian', 'plugin', 'connected', 'https://mcp.atlassian.com/v1/mcp'],
      ['plugin:slack:slack', 'plugin', 'needs-auth', 'https://mcp.slack.com/mcp'],
      ['codegraph', 'user', 'connected', 'codegraph serve --mcp'],
      ['broken', 'project', 'failed', '/nonexistent/bin --token ••••']
    ])
  })
})

describe('findAuthorizeUrl', () => {
  it('takes the OSC 8 link target the CLI prints after "Visit this URL to authorize"', () => {
    const output =
      'Visit this URL to authorize:\r\n  \u001b]8;;https://mcp.example.com/authorize?state=s&code_challenge=c\u0007\u001b[94mhttps://mcp.exa\r\nmple.com/authorize?state=s\u001b[39m\u001b]8;;\u0007\r\nWaiting for authorization…'
    expect(findAuthorizeUrl(output)).toBe(
      'https://mcp.example.com/authorize?state=s&code_challenge=c'
    )
  })

  it('waits for a plain URL to end before taking it, since output arrives in chunks', () => {
    const start = 'Open this URL to authorize: https://mcp.example.com/author'
    expect(findAuthorizeUrl(start)).toBeNull()
    expect(findAuthorizeUrl(`${start}ize?state=s\n`)).toBe(
      'https://mcp.example.com/authorize?state=s'
    )
  })
})

describe('sanitizeConnectorCommand', () => {
  it('masks secrets glued to header and variable names', () => {
    expect(
      sanitizeConnectorCommand([
        'npx',
        'mcp-remote',
        '--header',
        'X-Api-Key:abc',
        '--header',
        'Authorization:Bearer',
        'xyz',
        'API_TOKEN=def',
        'Authorization:',
        'Basic',
        'ghi',
        'PORT=3000'
      ])
    ).toBe(
      'npx mcp-remote --header X-Api-Key:•••• --header Authorization:•••• •••• API_TOKEN=•••• Authorization: •••• •••• PORT=3000'
    )
  })
})
