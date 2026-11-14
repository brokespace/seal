import type { HomeChatTurnRecorder } from '../../engine/home-chat-turn-recorder'

type Rec = Record<string, unknown>
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null

export const SEAL_MCP_SERVER_NAME = 'seal'

function mcpResultText(item: Rec): string {
  if (isRec(item.error) && typeof item.error.message === 'string') {
    return item.error.message
  }
  const content =
    isRec(item.result) && Array.isArray(item.result.content) ? item.result.content : []
  return content
    .filter(isRec)
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('\n')
}

/**
 * Reads the JSON lines `codex exec --json` prints. With a recorder it writes the turn; without one
 * it only collects the reply text (summaries).
 */
export class CodexExecEvents {
  sessionId: string | null = null
  replyText = ''
  error: string | null = null
  sawOutput = false
  private buffer = ''

  constructor(
    private readonly recorder: HomeChatTurnRecorder | null,
    /** Codex numbers items per run; the thread needs ids that never repeat. */
    private readonly runId: string
  ) {}

  feed(chunk: string): void {
    this.buffer += chunk
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      this.line(line)
    }
  }

  end(): void {
    this.line(this.buffer)
    this.buffer = ''
  }

  private line(line: string): void {
    if (!line.trim().startsWith('{')) {
      return
    }
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    if (!isRec(event)) {
      return
    }
    switch (event.type) {
      case 'thread.started':
        if (typeof event.thread_id === 'string') {
          this.sessionId = event.thread_id
        }
        break
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        if (isRec(event.item)) {
          this.item(event.item, event.type === 'item.completed')
        }
        break
      case 'turn.failed':
        this.error =
          isRec(event.error) && typeof event.error.message === 'string'
            ? event.error.message
            : 'Codex could not finish the turn.'
        break
      case 'error':
        this.error = typeof event.message === 'string' ? event.message : 'Codex reported an error.'
        break
    }
  }

  private item(item: Rec, completed: boolean): void {
    const callId = `${this.runId}:${String(item.id)}`
    switch (item.type) {
      case 'agent_message':
        if (completed && typeof item.text === 'string' && item.text) {
          this.sawOutput = true
          this.replyText += item.text
          this.recorder?.text(item.text)
          this.recorder?.settleText()
        }
        break
      case 'reasoning':
        if (completed && typeof item.text === 'string' && item.text) {
          this.recorder?.thinking(item.text)
          this.recorder?.settleText()
        }
        break
      case 'mcp_tool_call': {
        this.sawOutput = true
        const tool =
          item.server === SEAL_MCP_SERVER_NAME
            ? String(item.tool)
            : `${String(item.server)}.${String(item.tool)}`
        this.recorder?.toolCall({
          callId,
          tool,
          input: isRec(item.arguments) ? item.arguments : {}
        })
        if (completed) {
          // Seal's own tools were answered by the tool runner; the recorder keeps the first answer.
          this.recorder?.toolResult({
            callId,
            tool,
            content: mcpResultText(item),
            outcome: item.status === 'failed' ? 'error' : 'ok'
          })
        }
        break
      }
      case 'command_execution':
        this.sawOutput = true
        this.recorder?.toolCall({
          callId,
          tool: 'codex_shell',
          input: { command: String(item.command ?? '') }
        })
        if (completed) {
          this.recorder?.toolResult({
            callId,
            tool: 'codex_shell',
            content: String(item.aggregated_output ?? ''),
            outcome: item.exit_code === 0 ? 'ok' : 'error',
            machine: 'This computer'
          })
        }
        break
    }
  }
}
