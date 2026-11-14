import type { HandlerGroup } from '../dispatch/handler-group-manifest'
import { MCP_COMMAND_SPECS } from '../specs/mcp'

export const SEAL_MCP_HANDLER_GROUP: HandlerGroup = {
  name: 'seal-mcp',
  // Taken from the specs, so a command that is documented always has its handler.
  keys: MCP_COMMAND_SPECS.map((spec) => spec.path.join(' ')),
  load: async () => (await import('./seal-mcp-commands.js')).SEAL_MCP_HANDLERS
}
