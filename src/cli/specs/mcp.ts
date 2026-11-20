import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const HOST_NOTE =
  '--environment <id> manages the MCP server of that paired Seal server instead of this one.'

// Seal's MCP server: `seal mcp` is the stdio transport; the rest manage clients on a host.
export const MCP_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['mcp'],
    summary: 'Run Seal as an MCP server on stdio, for Claude Code, Codex, Cursor and other clients',
    usage: 'SEAL_MCP_TOKEN=<token> seal mcp [--environment <id>]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Reads one JSON-RPC message per line on stdin and answers on stdout. The token in SEAL_MCP_TOKEN decides which tools exist and which machines they reach.',
      'Needs Seal running here (the app or `seal serve`). With --environment it drives a paired Seal server over the encrypted pairing channel, so the relay cannot read or forge the calls.',
      'See docs/mcp.md for client configuration and the threat model.'
    ],
    examples: [
      'claude mcp add seal --env SEAL_MCP_TOKEN=smcp_... -- seal mcp',
      'SEAL_MCP_TOKEN=smcp_... seal mcp --environment kessel-ml'
    ]
  },
  {
    path: ['mcp', 'status'],
    summary: 'Show where the MCP server is reachable and how many clients it has',
    usage: 'seal mcp status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [HOST_NOTE]
  },
  {
    path: ['mcp', 'enable'],
    summary: 'Accept MCP clients over HTTP on this server’s port, or through the Seal relay',
    usage: 'seal mcp enable http|relay [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'transport'],
    positionalArgs: ['transport'],
    notes: [
      'http serves /mcp on the port Seal already listens on; it is plain HTTP, meant for a LAN or tailnet.',
      'relay gives a public HTTPS URL. The relay terminates TLS, so it can read what passes through; only clients created with --allow-relay may use it.',
      HOST_NOTE
    ]
  },
  {
    path: ['mcp', 'disable'],
    summary: 'Stop accepting MCP clients over HTTP or through the relay',
    usage: 'seal mcp disable http|relay [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'transport'],
    positionalArgs: ['transport']
  },
  {
    path: ['mcp', 'token', 'create'],
    summary: 'Create an MCP client and print its token once',
    usage:
      'seal mcp token create --name <name> [--scopes read,sessions,files,commands,destructive] [--machines <id,id>] [--approval never|destructive|commands] [--allow-relay] [--rate <calls-per-minute>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'name',
      'scopes',
      'machines',
      'approval',
      'allow-relay',
      'rate'
    ],
    notes: [
      'Scopes default to read. A tool needs every scope it lists; anything not granted does not exist for the client.',
      'commands is a shell as your user on every allowed machine: treat it as full access to them.',
      '--machines limits the client to those machine ids (see the list_machines tool); without it every machine is allowed.',
      '--approval destructive (the default) asks in the Seal app before destructive calls; commands asks before every command as well.',
      HOST_NOTE
    ],
    examples: [
      'seal mcp token create --name "Claude Code" --scopes read,sessions',
      'seal mcp token create --name assistant --scopes read,sessions,commands --machines local --approval commands --allow-relay'
    ]
  },
  {
    path: ['mcp', 'token', 'list'],
    summary: 'List MCP clients with their scopes, machines and last use',
    usage: 'seal mcp token list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['mcp', 'token', 'revoke'],
    destructive: true,
    summary: 'Revoke an MCP client; its token stops working at once',
    usage: 'seal mcp token revoke <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id']
  },
  {
    path: ['mcp', 'token', 'rm'],
    destructive: true,
    summary: 'Revoke an MCP client and remove it from the list',
    usage: 'seal mcp token rm <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id']
  },
  {
    path: ['mcp', 'machines'],
    summary: 'List the machines an MCP client can be limited to, with the ids --machines takes',
    usage: 'seal mcp machines [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['mcp', 'audit'],
    summary: 'Show recent MCP calls: who, what, where, and whether Seal allowed them',
    usage: 'seal mcp audit [--client <id>] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'client', 'limit']
  },
  {
    path: ['mcp', 'approvals'],
    summary: 'List MCP calls waiting for approval',
    usage: 'seal mcp approvals [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['mcp', 'approve'],
    summary: 'Approve a waiting MCP call',
    usage: 'seal mcp approve <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id']
  },
  {
    path: ['mcp', 'deny'],
    summary: 'Deny a waiting MCP call',
    usage: 'seal mcp deny <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id']
  }
]
