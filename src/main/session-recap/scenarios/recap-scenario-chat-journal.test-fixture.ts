// A scenario's conversation as a structured chat journals it: rows by sequence, subagents under their own agent id.
import type {
  AgentJournalBoundedPayload,
  AgentJournalItemBody,
  AgentJournalRenderItem
} from '../../../shared/agent-session/journal/agent-session-journal-types'
import type { ChatJournalRead } from '../../live-sessions/transcripts/journal-session-transcript'
import type { RecapScenarioConversation } from './recap-scenario-claude-transcript.test-fixture'

function payload(text: string): AgentJournalBoundedPayload {
  return { head: text, byteLength: text.length, digest: 'scenario', truncated: false }
}

export type ChatJournalScenario = {
  conversation: RecapScenarioConversation
  read: ChatJournalRead
  /** A turn is running: the journal holds back the row still being written. */
  setWorking(working: boolean): void
}

/** The agent behind the chat, which decides the names its tools are journaled under. */
export type ChatJournalAgent = 'claude' | 'opencode' | 'copilot'

/**
 * A shell command as each agent's chat journals it. OpenCode 2 names its tool `shell`
 * (`acp/fixtures/opencode-v2-tool.jsonl`). No recording holds Copilot's name for it: `execute` is
 * the ACP kind, which the journal falls back to.
 */
const COMMAND_TOOL: Record<ChatJournalAgent, string> = {
  claude: 'Bash',
  opencode: 'shell',
  copilot: 'execute'
}

export function chatJournalScenario(agent: ChatJournalAgent = 'claude'): ChatJournalScenario {
  const items: AgentJournalRenderItem[] = []
  let sequence = 0
  let working = false

  const add = (body: AgentJournalItemBody, at: number, agentId?: string): void => {
    sequence++
    items.push({
      itemId: `item-${sequence}`,
      revision: 0,
      sequence,
      observedAt: at,
      body,
      ...(agentId ? { agentId } : {})
    })
  }
  const said = (role: 'user' | 'assistant', text: string, at: number, agentId?: string): void =>
    add(
      {
        kind: 'message',
        role,
        blocks: [{ type: 'text', text }],
        ...(role === 'assistant' ? { state: 'completed' as const } : {})
      },
      at,
      agentId
    )

  return {
    setWorking: (next) => {
      working = next
    },
    read: {
      snapshot: async () => ({ cursor: { epoch: 'scenario', sequence }, items: [...items] }),
      working: () => working
    },
    conversation: {
      async write(step, at) {
        if ('user' in step) {
          said('user', step.user, at)
        } else if ('agent' in step) {
          said('assistant', step.agent, at)
        } else if ('tool' in step) {
          const command = step.tool.name === 'Bash' && agent !== 'claude'
          add(
            {
              kind: 'tool-call',
              name: command ? COMMAND_TOOL[agent] : step.tool.name,
              input: command ? { ...step.tool.input, cwd: '/srv/shop' } : step.tool.input,
              state: 'completed',
              output: payload(step.tool.output ?? '')
            },
            at
          )
        } else if ('edit' in step) {
          add({ kind: 'diff', path: step.edit, patch: payload('-before\n+after') }, at)
        } else if ('question' in step) {
          const { text, options, answer } = step.question
          const answered = answer === undefined ? -1 : options.indexOf(answer)
          add(
            {
              kind: 'question',
              question: text,
              options: options.map((label, index) => ({ id: `option-${index}`, label })),
              resolution:
                answered === -1
                  ? { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
                  : {
                      state: 'resolved',
                      selectedOptionId: `option-${answered}`,
                      resolvedBy: 'scenario',
                      resolvedAt: at
                    }
            },
            at
          )
        } else if ('subagent' in step) {
          if (agent === 'copilot') {
            // No recording holds the call Copilot starts a subagent with.
            return false
          }
          const { prompt, says, result } = step.subagent
          const agentId = `sub-${sequence + 1}`
          const description = prompt.slice(0, 40)
          add(
            {
              kind: 'tool-call',
              // OpenCode 2's, as in `acp/fixtures/opencode-v2-subagent-foreground.jsonl`.
              name: agent === 'opencode' ? 'subagent' : 'Task',
              input:
                agent === 'opencode'
                  ? { agent: 'general', description, prompt }
                  : { description, prompt },
              state: 'completed',
              output: payload(result)
            },
            at
          )
          said('user', prompt, at, agentId)
          for (const line of says) {
            said('assistant', line, at, agentId)
          }
        } else if ('compact' in step) {
          add({ kind: 'status', text: 'Conversation compacted', presentation: 'compaction' }, at)
        } else if ('injected' in step) {
          // A chat's host never journals what the harness splices into a turn.
        } else {
          return false
        }
        return true
      }
    }
  }
}
