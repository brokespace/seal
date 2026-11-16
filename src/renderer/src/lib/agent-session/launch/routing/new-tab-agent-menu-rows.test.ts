import { describe, expect, it } from 'vitest'
import type { AgentLaunchRoutingInput } from './agent-launch-routing'
import { hostChatAnswer } from './new-tab-agent-menu-rows'

const WSL: AgentLaunchRoutingInput['projectRuntime'] = {
  status: 'resolved',
  runtime: {
    kind: 'wsl',
    hostPlatform: 'wsl',
    projectId: 'project',
    distro: 'Ubuntu',
    reason: 'project-override',
    cacheKey: 'project:wsl:Ubuntu'
  }
}
const WSL_NEEDS_REPAIR: AgentLaunchRoutingInput['projectRuntime'] = {
  status: 'repair-required',
  repair: {
    projectId: 'project',
    preferredRuntime: { kind: 'wsl', distro: 'Ubuntu' },
    reason: 'wsl-distro-missing',
    source: 'project-override',
    cacheKey: 'project:repair:wsl-distro-missing:Ubuntu'
  }
}

function answerOnLocalProject(input: Partial<AgentLaunchRoutingInput>) {
  return hostChatAnswer({
    agent: 'claude',
    settings: null,
    executionHostId: 'local',
    hostCapabilities: [],
    nativeChatTranscriptIsLocalReadable: true,
    ...input
  })
}

describe('hostChatAnswer on a local Windows project that runs in WSL', () => {
  it('opens the chat as the CLI in chat view for an agent whose CLI has a chat view', () => {
    expect(answerOnLocalProject({ agent: 'claude', projectRuntime: WSL })).toBe('via-cli')
    expect(answerOnLocalProject({ agent: 'codex', projectRuntime: WSL })).toBe('via-cli')
  })

  it('refuses the chat while the WSL runtime needs repair', () => {
    expect(answerOnLocalProject({ projectRuntime: WSL_NEEDS_REPAIR })).toBe('wsl')
  })

  it('refuses the chat for an agent whose CLI has no chat view', () => {
    expect(
      answerOnLocalProject({
        agent: 'gemini',
        hostStructuredAgents: ['gemini'],
        projectRuntime: WSL
      })
    ).toBe('wsl')
  })
})
