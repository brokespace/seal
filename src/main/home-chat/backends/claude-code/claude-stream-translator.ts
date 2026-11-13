import type { HomeChatEntry } from '../../../../shared/home-chat/home-chat-types'
import type { HomeChatEntryHandle, HomeChatEntryWriter } from '../../home-chat-entry-writer'

/** Seal's own MCP tools render from the tool runner; only Claude's built-ins render from the stream. */
export const SEAL_MCP_SERVER_NAME = 'seal'
const SEAL_TOOL_PREFIX = `mcp__${SEAL_MCP_SERVER_NAME}__`

type Rec = Record<string, unknown>

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null
}

type TextHandle = {
  text: string
  kind: 'assistant' | 'thinking'
  update: (patch: { text?: string; streaming?: boolean; durationMs?: number }) => void
}
type ToolHandle = HomeChatEntryHandle<Extract<HomeChatEntry, { kind: 'tool' }>>

export type ClaudeTurnSignal = { sessionId?: string; turnDone?: boolean; error?: string }

/** Turns one Claude chat's SDK messages into chat entries; the copy that arrives last wins. */
export class ClaudeStreamTranslator {
  private readonly blocks = new Map<number, TextHandle>()
  private readonly streamedMessageIds = new Set<string>()
  private readonly builtinTools = new Map<string, ToolHandle>()
  private thinkingStartedAt = 0

  constructor(private readonly writer: HomeChatEntryWriter) {}

  handle(message: Rec): ClaudeTurnSignal {
    const sessionId = typeof message.session_id === 'string' ? message.session_id : undefined
    // Subagent traffic belongs to its Task tool call, not the main conversation.
    if (message.parent_tool_use_id) {
      return { sessionId }
    }
    switch (message.type) {
      case 'stream_event':
        this.onStreamEvent(isRec(message.event) ? message.event : {})
        break
      case 'assistant':
        this.onAssistant(isRec(message.message) ? message.message : {})
        break
      case 'user':
        this.onUser(isRec(message.message) ? message.message : {})
        break
      case 'result':
        return this.onResult(message, sessionId)
    }
    return { sessionId }
  }

  /** Close anything still streaming, e.g. after an interrupt. */
  finish(): void {
    for (const handle of this.blocks.values()) {
      this.settle(handle)
    }
    this.blocks.clear()
  }

  private onStreamEvent(event: Rec): void {
    const index = typeof event.index === 'number' ? event.index : -1
    if (event.type === 'message_start' && isRec(event.message)) {
      if (typeof event.message.id === 'string') {
        this.streamedMessageIds.add(event.message.id)
      }
      this.blocks.clear()
    } else if (event.type === 'content_block_start' && isRec(event.content_block)) {
      const type = event.content_block.type
      if (type === 'text' || type === 'thinking') {
        this.blocks.set(index, this.open(type === 'text' ? 'assistant' : 'thinking'))
      }
    } else if (event.type === 'content_block_delta' && isRec(event.delta)) {
      const handle = this.blocks.get(index)
      const delta = event.delta
      const chunk =
        delta.type === 'text_delta'
          ? delta.text
          : delta.type === 'thinking_delta'
            ? delta.thinking
            : null
      if (handle && typeof chunk === 'string' && chunk) {
        handle.text += chunk
        handle.update({ text: handle.text })
      }
    } else if (event.type === 'content_block_stop') {
      const handle = this.blocks.get(index)
      if (handle) {
        this.settle(handle)
        this.blocks.delete(index)
      }
    }
  }

  private open(kind: 'assistant' | 'thinking'): TextHandle {
    if (kind === 'thinking') {
      this.thinkingStartedAt = Date.now()
    }
    const handle = this.writer.create({ kind, text: '', streaming: true })
    return { text: '', kind, update: handle.update }
  }

  private settle(handle: TextHandle): void {
    handle.update(
      handle.kind === 'thinking'
        ? { text: handle.text, streaming: false, durationMs: Date.now() - this.thinkingStartedAt }
        : { text: handle.text, streaming: false }
    )
  }

  private onAssistant(message: Rec): void {
    const content = Array.isArray(message.content) ? message.content.filter(isRec) : []
    const streamed = typeof message.id === 'string' && this.streamedMessageIds.has(message.id)
    for (const block of content) {
      if (!streamed && block.type === 'text' && typeof block.text === 'string' && block.text) {
        this.writer.create({ kind: 'assistant', text: block.text, streaming: false })
      }
      if (
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        this.onToolUse(block.id, block.name, isRec(block.input) ? block.input : {})
      }
    }
  }

  private onToolUse(id: string, name: string, input: Rec): void {
    if (name.startsWith(SEAL_TOOL_PREFIX) || this.builtinTools.has(id)) {
      return
    }
    this.builtinTools.set(
      id,
      this.writer.create({ kind: 'tool', tool: name, input, status: 'running' })
    )
  }

  private onUser(message: Rec): void {
    const content = Array.isArray(message.content) ? message.content.filter(isRec) : []
    for (const block of content) {
      const handle =
        block.type === 'tool_result' && typeof block.tool_use_id === 'string'
          ? this.builtinTools.get(block.tool_use_id)
          : undefined
      if (!handle) {
        continue
      }
      handle.update({
        status: block.is_error === true ? 'error' : 'ok',
        output: toolResultText(block.content)
      })
    }
  }

  private onResult(message: Rec, sessionId: string | undefined): ClaudeTurnSignal {
    this.finish()
    const failed = message.is_error === true || message.subtype !== 'success'
    if (!failed) {
      return { sessionId, turnDone: true }
    }
    const errors = Array.isArray(message.errors) ? message.errors.map(String).join('\n') : ''
    const detail =
      (typeof message.result === 'string' && message.result) ||
      errors ||
      `Claude stopped (${String(message.subtype)})`
    return { sessionId, turnDone: true, error: detail }
  }
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .filter(isRec)
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('\n')
}
