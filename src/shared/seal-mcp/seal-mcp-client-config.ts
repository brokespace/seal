/** How an MCP client reaches a Seal server. */
export type SealMcpConnection =
  /** `seal mcp` on the client's own computer; `environment` names a paired Seal server to drive. */
  | { kind: 'stdio'; environment: string | null }
  /** The LAN endpoint or the relay URL. */
  | { kind: 'http'; url: string }

export type SealMcpClientSnippet = {
  id: 'claude-code' | 'codex' | 'cursor' | 'generic'
  /** A product name, shown as is. */
  title: string
  /** Where the text goes: a shell, or the named config file. */
  target: string
  language: 'bash' | 'toml' | 'json'
  text: string
}

export const SEAL_MCP_TOKEN_PLACEHOLDER = '<token>'

function stdioArgs(environment: string | null): string[] {
  return environment ? ['mcp', '--environment', environment] : ['mcp']
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function stdioSnippets(environment: string | null, token: string): SealMcpClientSnippet[] {
  const args = stdioArgs(environment)
  return [
    {
      id: 'claude-code',
      title: 'Claude Code',
      target: 'shell',
      language: 'bash',
      text: `claude mcp add seal --env SEAL_MCP_TOKEN=${token} -- seal ${args.join(' ')}`
    },
    {
      id: 'codex',
      title: 'Codex',
      target: '~/.codex/config.toml',
      language: 'toml',
      text: [
        '[mcp_servers.seal]',
        'command = "seal"',
        `args = [${args.map((arg) => JSON.stringify(arg)).join(', ')}]`,
        `env = { SEAL_MCP_TOKEN = "${token}" }`
      ].join('\n')
    },
    {
      id: 'cursor',
      title: 'Cursor',
      target: '~/.cursor/mcp.json',
      language: 'json',
      text: json({
        mcpServers: { seal: { command: 'seal', args, env: { SEAL_MCP_TOKEN: token } } }
      })
    },
    {
      id: 'generic',
      title: 'Any stdio client',
      target: 'shell',
      language: 'bash',
      text: `SEAL_MCP_TOKEN=${token} seal ${args.join(' ')}`
    }
  ]
}

function httpSnippets(url: string, token: string): SealMcpClientSnippet[] {
  return [
    {
      id: 'claude-code',
      title: 'Claude Code',
      target: 'shell',
      language: 'bash',
      text: `claude mcp add --transport http seal ${url} --header "Authorization: Bearer ${token}"`
    },
    {
      id: 'codex',
      title: 'Codex',
      target: '~/.codex/config.toml',
      language: 'toml',
      text: [
        `# Codex reads the token from the environment: export SEAL_MCP_TOKEN=${token}`,
        '[mcp_servers.seal]',
        `url = "${url}"`,
        'bearer_token_env_var = "SEAL_MCP_TOKEN"'
      ].join('\n')
    },
    {
      id: 'cursor',
      title: 'Cursor',
      target: '~/.cursor/mcp.json',
      language: 'json',
      text: json({ mcpServers: { seal: { url, headers: { Authorization: `Bearer ${token}` } } } })
    },
    {
      id: 'generic',
      title: 'Any HTTP client',
      target: 'shell',
      language: 'bash',
      text: [
        `curl -sS ${url} \\`,
        `  -H "Authorization: Bearer ${token}" \\`,
        '  -H "Content-Type: application/json" \\',
        '  -H "Accept: application/json, text/event-stream" \\',
        `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`
      ].join('\n')
    }
  ]
}

/** Copy-paste setup for each supported client. Pass the real token only while it is on screen. */
export function sealMcpClientSnippets(
  connection: SealMcpConnection,
  token: string = SEAL_MCP_TOKEN_PLACEHOLDER
): SealMcpClientSnippet[] {
  return connection.kind === 'stdio'
    ? stdioSnippets(connection.environment, token)
    : httpSnippets(connection.url, token)
}
