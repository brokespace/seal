import type * as ClaudeAgentSdk from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeStructuredSdkOptions } from './structured/launch/claude-structured-launch-resolution'

/** Home chat scopes Claude's tools and can keep its turns out of the user's session history. */
export type ClaudeStreamJsonSdkOptions = ClaudeStructuredSdkOptions &
  Pick<
    ClaudeAgentSdk.Options,
    'mcpServers' | 'allowedTools' | 'disallowedTools' | 'tools' | 'persistSession'
  >
