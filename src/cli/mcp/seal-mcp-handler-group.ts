import type { HandlerGroup } from '../dispatch/handler-group-manifest'

export const SEAL_MCP_HANDLER_GROUP: HandlerGroup = {
  name: 'seal-mcp',
  keys: [
    'mcp',
    'mcp status',
    'mcp enable',
    'mcp disable',
    'mcp token create',
    'mcp token list',
    'mcp token revoke',
    'mcp token rm',
    'mcp audit',
    'mcp approvals',
    'mcp approve',
    'mcp deny'
  ],
  load: async () => (await import('./seal-mcp-commands.js')).SEAL_MCP_HANDLERS
}
