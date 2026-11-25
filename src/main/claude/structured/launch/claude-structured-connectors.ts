import { resolveChatConnectors } from '../../../seal-connectors/seal-connectors-session-plan'
import { claudeSdkConnectorOptions } from '../../../../shared/seal-connectors/session-connector-args'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import type { Options as ClaudeAgentSdkOptions } from '@anthropic-ai/claude-agent-sdk'

/** The SDK options a strict, Seal-listed session sets. */
export type ClaudeStructuredConnectorOptions = Pick<
  ClaudeAgentSdkOptions,
  'plugins' | 'mcpServers' | 'strictMcpConfig' | 'disallowedTools'
>

type SdkPlugins = NonNullable<ClaudeStructuredConnectorOptions['plugins']>

/**
 * Seal's central connectors as SDK options (strict, so the agent's own MCP config stays out) plus
 * the env that carries the relay key. Empty when this host has no loaded list.
 */
export async function claudeStructuredConnectorLaunch(
  record: Pick<AgentSessionRecord, 'sessionId' | 'location'>,
  visualsPluginDir: string | null
): Promise<{
  options: ClaudeStructuredConnectorOptions
  env: Record<string, string>
}> {
  const plan = await resolveChatConnectors(record, 'claude')
  const visuals: SdkPlugins = visualsPluginDir ? [{ type: 'local', path: visualsPluginDir }] : []
  if (!plan) {
    return { options: visuals.length > 0 ? { plugins: visuals } : {}, env: {} }
  }
  const connectors = claudeSdkConnectorOptions(plan)
  return {
    options: {
      plugins: [...visuals, ...connectors.plugins],
      mcpServers: connectors.mcpServers,
      strictMcpConfig: connectors.strictMcpConfig,
      ...(connectors.disallowedTools.length > 0
        ? { disallowedTools: connectors.disallowedTools }
        : {})
    },
    env: plan.env
  }
}
