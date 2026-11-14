import type { HomeChatTurnRecorder } from '../../engine/home-chat-turn-recorder'

export const SEAL_MCP_SERVER_NAME = 'seal'
const SEAL_TOOL_PREFIX = `mcp__${SEAL_MCP_SERVER_NAME}__`

type Rec = Record<string, unknown>

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null
}

function blocks(message: unknown): Rec[] {
  return isRec(message) && Array.isArray(message.content) ? message.content.filter(isRec) : []
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  return Array.isArray(content)
    ? content
        .filter(isRec)
        .map((part) => (typeof part.text === 'string' ? part.text : ''))
        .join('\n')
    : ''
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

export type ClaudeTurnOutcome = { done: true; error?: string } | { done: false }

/**
 * Reads one Claude Code run's SDK messages. With a recorder it writes the turn; without one it only
 * collects the reply text (summaries).
 */
export class ClaudeTurnStream {
  sessionId: string | null = null
  /** Tokens in Claude's context after its latest round. */
  contextTokens: number | null = null
  /** Every text block of the run, for callers that want the reply itself. */
  replyText = ''
  sawAssistant = false
  private readonly streamedMessageIds = new Set<string>()
  private readonly toolNames = new Map<string, string>()

  constructor(private readonly recorder: HomeChatTurnRecorder | null) {}

  handle(message: Rec): ClaudeTurnOutcome {
    if (typeof message.session_id === 'string') {
      this.sessionId = message.session_id
    }
    // Subagent traffic belongs to its own tool call, not this conversation.
    if (message.parent_tool_use_id) {
      return { done: false }
    }
    switch (message.type) {
      case 'stream_event':
        this.onStreamEvent(isRec(message.event) ? message.event : {})
        break
      case 'assistant':
        this.onAssistant(isRec(message.message) ? message.message : {})
        break
      case 'user':
        this.onUser(message.message)
        break
      case 'result':
        return this.onResult(message)
    }
    return { done: false }
  }

  private onStreamEvent(event: Rec): void {
    if (event.type === 'message_start' && isRec(event.message)) {
      if (typeof event.message.id === 'string') {
        this.streamedMessageIds.add(event.message.id)
      }
    } else if (event.type === 'content_block_delta' && isRec(event.delta)) {
      const { delta } = event
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        this.recorder?.text(delta.text)
      } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        this.recorder?.thinking(delta.thinking)
      }
    } else if (event.type === 'content_block_stop') {
      this.recorder?.settleText()
    }
  }

  private onAssistant(message: Rec): void {
    this.sawAssistant = true
    const streamed = typeof message.id === 'string' && this.streamedMessageIds.has(message.id)
    if (isRec(message.usage)) {
      const { usage } = message
      this.contextTokens =
        num(usage.input_tokens) +
        num(usage.cache_read_input_tokens) +
        num(usage.cache_creation_input_tokens) +
        num(usage.output_tokens)
    }
    for (const block of blocks(message)) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text) {
        this.replyText += block.text
        if (!streamed) {
          this.recorder?.text(block.text)
          this.recorder?.settleText()
        }
      }
      if (
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        const tool = block.name.startsWith(SEAL_TOOL_PREFIX)
          ? block.name.slice(SEAL_TOOL_PREFIX.length)
          : block.name
        this.toolNames.set(block.id, tool)
        this.recorder?.toolCall({
          callId: block.id,
          tool,
          input: isRec(block.input) ? block.input : {}
        })
      }
    }
  }

  /**
   * Claude's own record of each tool answer. Seal's tools were already answered by the tool runner
   * (the recorder keeps the first answer); this catches calls Claude rejected before they reached it.
   */
  private onUser(message: unknown): void {
    for (const block of blocks(message)) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') {
        continue
      }
      this.recorder?.toolResult({
        callId: block.tool_use_id,
        tool: this.toolNames.get(block.tool_use_id) ?? 'tool',
        content: toolResultText(block.content),
        outcome: block.is_error === true ? 'error' : 'ok'
      })
    }
  }

  private onResult(message: Rec): ClaudeTurnOutcome {
    this.recorder?.settleText()
    if (message.is_error !== true && message.subtype === 'success') {
      return { done: true }
    }
    const errors = Array.isArray(message.errors) ? message.errors.map(String).join('\n') : ''
    return {
      done: true,
      error:
        (typeof message.result === 'string' && message.result) ||
        errors ||
        `Claude stopped (${String(message.subtype)})`
    }
  }
}
