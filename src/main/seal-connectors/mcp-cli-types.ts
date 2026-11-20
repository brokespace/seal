/** Where the agent got the server from; claude.ai connectors are managed on claude.ai. */
export type McpCliServerKind = 'claude-ai' | 'plugin' | 'user' | 'project'

/** `configured` means the agent lists it but did not health-check it (Codex does not). */
export type McpCliServerStatus = 'connected' | 'needs-auth' | 'failed' | 'disabled' | 'configured'

export type McpCliServer = {
  name: string
  kind: McpCliServerKind
  transport: 'http' | 'sse' | 'stdio' | null
  /** URL without query or credentials, or the command with secret-looking arguments masked. */
  target: string
  status: McpCliServerStatus
  /** The agent's own words about the status, such as the connect error. */
  detail: string | null
}

export type ConnectorSignInResult = { ok: boolean; message: string | null }

/** `finished` when the CLI ended before printing a page to open (already signed in, or failed). */
export type ConnectorSignInStart =
  | { kind: 'url'; sessionId: string; url: string }
  | { kind: 'finished'; result: ConnectorSignInResult }
