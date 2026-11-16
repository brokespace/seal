// The adapter table: one entry per agent, read from upstream's own catalogs so nothing is restated.
import { TUI_AGENT_DISPLAY_NAMES } from '../../agent-launch/catalog/tui-agent-display-names'
import { getAgentResumeArgv } from '../../agent-launch/startup/agent-resume-argv'
import {
  isResumableTuiAgent,
  type AgentProviderSessionKey
} from '../../agent-session/lifecycle/agent-session-resume'
import {
  isNativeChatSupportedAgent,
  nativeChatRequiresLocalTranscript,
  resolveNativeChatTranscriptAgent,
  shouldStepNativeChatAskAnswer
} from '../../native-chat/native-chat-agent-support'
import type { AgentSessionAdapter, AgentSessionChatRuntime } from './agent-session-adapter'
import { contextSampleReaderOf } from './agent-session-context-samples'
import {
  AGENT_SESSION_AGENT_IDS,
  isAgentSessionAgentId,
  type AgentSessionAgentId
} from './agent-session-agent-ids'

/**
 * The structured runtime behind each agent's chat. Mirrors the main-only runtime catalog
 * (`structured-agent-runtime-metadata.ts`: Claude, Codex, Pi and the ACP launch specs), which
 * shared code cannot import.
 */
const CHAT_RUNTIMES: Partial<Record<AgentSessionAgentId, AgentSessionChatRuntime>> = {
  claude: 'claude',
  codex: 'codex',
  pi: 'pi',
  grok: 'acp',
  opencode: 'acp',
  opencode2: 'acp',
  omp: 'acp',
  antigravity: 'acp',
  copilot: 'acp',
  kimi: 'acp'
}

/** Names session rows and notifications already use that differ from the launcher's. */
const LABELS: Partial<Record<AgentSessionAgentId, string>> = {
  claude: 'Claude Code'
}

/** An agent resumes by one of these hook fields; its resume argv rejects the other. */
const PROVIDER_SESSION_KEYS: readonly AgentProviderSessionKey[] = ['session_id', 'conversation_id']

function cliAnswers(
  agent: AgentSessionAgentId
): NonNullable<AgentSessionAdapter['cli']>['answers'] {
  if (shouldStepNativeChatAskAnswer(agent)) {
    return 'ask-steps'
  }
  // Grok and OMP take an option's key; OMP's questions still need its terminal.
  return isNativeChatSupportedAgent(agent) ? 'option-keys' : 'none'
}

function adapterOf(agent: AgentSessionAgentId): AgentSessionAdapter {
  const runtime = CHAT_RUNTIMES[agent]
  const decoder = resolveNativeChatTranscriptAgent(agent)
  const usageOf = contextSampleReaderOf(decoder)
  return {
    agent,
    label: LABELS[agent] ?? TUI_AGENT_DISPLAY_NAMES[agent],
    ...(runtime ? { chat: { runtime } } : {}),
    cli: {
      answers: cliAnswers(agent),
      ...(isResumableTuiAgent(agent)
        ? {
            resumeArgv: (providerSessionId, transcriptPath) => {
              for (const key of PROVIDER_SESSION_KEYS) {
                const argv = getAgentResumeArgv(agent, {
                  key,
                  id: providerSessionId,
                  ...(transcriptPath ? { transcriptPath } : {})
                })
                if (argv) {
                  return argv
                }
              }
              return null
            }
          }
        : {})
    },
    ...(decoder
      ? {
          transcript: {
            decoder,
            remoteReadable: !nativeChatRequiresLocalTranscript(agent),
            ...(usageOf ? { usageOf } : {})
          }
        }
      : {})
  }
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: one entry is built per id in AGENT_SESSION_AGENT_IDS, the union the record is keyed by.
export const AGENT_SESSION_ADAPTERS = Object.fromEntries(
  AGENT_SESSION_AGENT_IDS.map((agent) => [agent, adapterOf(agent)])
) as Readonly<Record<AgentSessionAgentId, AgentSessionAdapter>>

/** The adapter of `agent`, or null when Seal's session code does not know the agent. */
export function agentSessionAdapter(agent: string | null | undefined): AgentSessionAdapter | null {
  return isAgentSessionAgentId(agent) ? AGENT_SESSION_ADAPTERS[agent] : null
}
