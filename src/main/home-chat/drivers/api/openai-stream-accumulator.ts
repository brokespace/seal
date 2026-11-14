// Chat Completions streaming (SSE) as OpenAI, OpenRouter, xAI, vLLM, Ollama and LM Studio serve it.

export type OpenAiToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type OpenAiChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export type OpenAiStreamDelta = { kind: 'text' | 'reasoning'; text: string }

export type OpenAiUsage = { promptTokens: number; completionTokens: number }

export type OpenAiStreamResult = {
  content: string
  reasoning: string
  toolCalls: OpenAiToolCall[]
  finishReason: string | null
  /** Present when the server reports it (`stream_options.include_usage`). */
  usage: OpenAiUsage | null
}

type Rec = Record<string, unknown>
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null

export class OpenAiStreamAccumulator {
  private buffer = ''
  private content = ''
  private reasoning = ''
  private finishReason: string | null = null
  private usage: OpenAiUsage | null = null
  private readonly calls = new Map<number, OpenAiToolCall>()

  /** Feed raw response text in any chunking; returns the visible deltas it completed. */
  feed(chunk: string): OpenAiStreamDelta[] {
    this.buffer += chunk
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ''
    return lines.flatMap((line) => this.line(line))
  }

  result(): OpenAiStreamResult {
    // A stream that ends without a final newline still carries its last event.
    if (this.buffer) {
      this.line(this.buffer)
      this.buffer = ''
    }
    const toolCalls = [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }))
    return {
      content: this.content,
      reasoning: this.reasoning,
      toolCalls,
      finishReason: this.finishReason,
      usage: this.usage
    }
  }

  private line(line: string): OpenAiStreamDelta[] {
    if (!line.startsWith('data:')) {
      return []
    }
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') {
      return []
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return []
    }
    if (isRec(parsed) && isRec(parsed.error)) {
      throw new Error(String(parsed.error.message ?? 'The model API returned an error'))
    }
    if (isRec(parsed) && isRec(parsed.usage) && typeof parsed.usage.prompt_tokens === 'number') {
      this.usage = {
        promptTokens: parsed.usage.prompt_tokens,
        completionTokens:
          typeof parsed.usage.completion_tokens === 'number' ? parsed.usage.completion_tokens : 0
      }
    }
    const choice = isRec(parsed) && Array.isArray(parsed.choices) ? parsed.choices[0] : null
    if (!isRec(choice)) {
      return []
    }
    if (typeof choice.finish_reason === 'string') {
      this.finishReason = choice.finish_reason
    }
    return isRec(choice.delta) ? this.delta(choice.delta) : []
  }

  private delta(delta: Rec): OpenAiStreamDelta[] {
    const out: OpenAiStreamDelta[] = []
    // Providers disagree on the reasoning field's name.
    const reasoning = delta.reasoning_content ?? delta.reasoning
    if (typeof reasoning === 'string' && reasoning) {
      this.reasoning += reasoning
      out.push({ kind: 'reasoning', text: reasoning })
    }
    if (typeof delta.content === 'string' && delta.content) {
      this.content += delta.content
      out.push({ kind: 'text', text: delta.content })
    }
    if (Array.isArray(delta.tool_calls)) {
      delta.tool_calls.filter(isRec).forEach((part, position) => {
        this.toolCallPart(part, typeof part.index === 'number' ? part.index : position)
      })
    }
    return out
  }

  private toolCallPart(part: Rec, index: number): void {
    const call = this.calls.get(index) ?? {
      id: '',
      type: 'function' as const,
      function: { name: '', arguments: '' }
    }
    if (typeof part.id === 'string' && part.id) {
      call.id = part.id
    }
    const fn = isRec(part.function) ? part.function : {}
    if (typeof fn.name === 'string') {
      call.function.name += fn.name
    }
    if (typeof fn.arguments === 'string') {
      call.function.arguments += fn.arguments
    }
    this.calls.set(index, call)
  }
}
