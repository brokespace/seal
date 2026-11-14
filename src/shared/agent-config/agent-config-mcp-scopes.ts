import type { AgentConfigLayout, AgentConfigMcpCodec } from './agent-config-catalog'

/** Where an agent keeps MCP servers; Claude Code alone has a private per-project place. */
export function agentConfigMcpScopes(
  layout: AgentConfigLayout,
  inProject: boolean
): { scope: 'user' | 'project' | 'local'; codec: AgentConfigMcpCodec; file: string }[] {
  const scopes: {
    scope: 'user' | 'project' | 'local'
    codec: AgentConfigMcpCodec
    file: string
  }[] = []
  if (layout.user.mcp) {
    scopes.push({ scope: 'user', codec: layout.user.mcp.codec, file: `~/${layout.user.mcp.path}` })
  }
  if (inProject && layout.project.mcp) {
    scopes.push({
      scope: 'project',
      codec: layout.project.mcp.codec,
      file: layout.project.mcp.path
    })
  }
  if (inProject && layout.id === 'claude' && layout.user.mcp) {
    scopes.push({ scope: 'local', codec: layout.user.mcp.codec, file: `~/${layout.user.mcp.path}` })
  }
  return scopes
}
