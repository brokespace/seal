import { hostChatAnswer } from '@/lib/agent-session/launch/routing/new-tab-agent-menu-rows'
import {
  buildAgentLaunchRouteInput,
  worktreeLaunchWorkspace,
  type AgentLaunchRouteStore
} from '@/lib/agent-session/launch/routing/agent-launch-route-input'
import { structuredAgentLaunchDowngrade } from '@/lib/agent-session/launch/routing/agent-launch-routing'
import type { LaunchAgentInNewTabArgs } from './launch-agent-in-new-tab-args'

/**
 * The view a terminal launch opens in when it is the chat of a host that runs no structured chat:
 * the caller asked for it, or the launch wanted a chat by default and fell back to the CLI there.
 */
export function terminalLaunchChatView(
  store: AgentLaunchRouteStore,
  args: LaunchAgentInNewTabArgs
): { viewMode: 'chat' } | undefined {
  if (args.opensInChatView) {
    return { viewMode: 'chat' }
  }
  // An explicit surface is the user's choice of CLI: only a default may fall back to chat view.
  if (args.requestedSurface || args.agentSessionLaunchPlan?.requestedSurface) {
    return undefined
  }
  const input = buildAgentLaunchRouteInput(store, {
    agent: args.agent,
    preferredSurface: args.preferredSurface,
    workspace: worktreeLaunchWorkspace(args.worktreeId),
    tuiCustomization: { cwd: args.initialCwd }
  })
  return structuredAgentLaunchDowngrade(input, 'terminal-tui') !== null &&
    hostChatAnswer(input) === 'via-cli'
    ? { viewMode: 'chat' }
    : undefined
}
