import {
  structuredAgentLaunchSupport,
  type AgentLaunchRoutingInput
} from '@/lib/agent-session/launch/routing/agent-launch-routing'
import { STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY as CATALOG } from '../../../../../../shared/agent-session/structured-agent-session-surface-capabilities'
import type { HostChatAnswer } from '../../../../../../shared/agent-launch/picker/agent-launch-picker-rows'
import { canToggleNativeChat } from '../../../../../../shared/native-chat/native-chat-availability'

/** A healthy WSL project runs no structured chat, but its terminal shows this agent's CLI as a chat. */
function wslCliOpensInChatView(input: AgentLaunchRoutingInput): boolean {
  const { projectRuntime } = input
  return (
    projectRuntime?.status === 'resolved' &&
    projectRuntime.runtime.kind === 'wsl' &&
    canToggleNativeChat({
      contentType: 'terminal',
      launchAgent: input.agent,
      nativeChatTranscriptIsLocalReadable: input.nativeChatTranscriptIsLocalReadable
    })
  )
}

export function hostChatAnswer(input: AgentLaunchRoutingInput): HostChatAnswer {
  const support = structuredAgentLaunchSupport(input)
  if (support.supported) {
    return 'yes'
  }
  switch (support.blocker) {
    case 'runtime-capability-unknown':
      return 'not-yet-known'
    case 'agent-without-structured-session':
      return !input.hostStructuredAgents && input.hostCapabilities?.includes(CATALOG) !== false
        ? 'not-yet-known'
        : 'not-on-host'
    case 'remote-execution-host':
      return 'needs-server'
    case 'project-runtime':
      return wslCliOpensInChatView(input) ? 'via-cli' : 'wsl'
    case 'runtime-capability':
    case 'client-capability':
      return 'no-chats'
    case 'custom-start-directory':
      return 'outside-workspace'
    case 'reused-terminal':
      return 'yes'
  }
}
