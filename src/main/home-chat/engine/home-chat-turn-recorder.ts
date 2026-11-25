import { randomUUID } from 'node:crypto'
import type {
  HomeChatEntry,
  HomeChatNoticeSource,
  HomeChatToolStatus
} from '../../../shared/home-chat/home-chat-types'
import {
  HIDDEN_TOOL_CALLS,
  INTERRUPTED_TOOL_TEXT,
  MAX_UI_OUTPUT_CHARS,
  toolStatusForOutcome
} from '../thread/home-chat-entry-projection'
import type { HomeChatThread } from '../thread/home-chat-thread'
import type {
  HomeChatAssistantPart,
  HomeChatRoundStop,
  HomeChatThreadEvent,
  HomeChatThreadItem,
  HomeChatToolCallPart,
  HomeChatToolOutcome
} from '../thread/home-chat-thread-items'

/** Streaming text is published at most this often; every other change goes out at once. */
const STREAM_PUBLISH_INTERVAL_MS = 40

type ToolEntry = Extract<HomeChatEntry, { kind: 'tool' }>
type TextEntry = Extract<HomeChatEntry, { kind: 'assistant' | 'thinking' }>
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type EntryFields = DistributiveOmit<HomeChatEntry, 'id' | 'rev' | 'at' | 'ord'>

type OpenText = {
  part: Extract<HomeChatAssistantPart, { kind: 'text' | 'thinking' }>
  startedAt: number
}

export type RecordedToolCall = { callId: string; tool: string; input: Record<string, unknown> }

/**
 * The only writer of a turn. Drivers describe what the model does; the recorder turns that into
 * thread items (durable, replayable) and chat entries (what the user watches), in one order.
 */
export class HomeChatTurnRecorder {
  private parts: HomeChatAssistantPart[] = []
  private open: OpenText | null = null
  private readonly live = new Map<string, HomeChatEntry>()
  private readonly callParts = new Map<string, HomeChatToolCallPart>()
  private readonly answered = new Set<string>()
  private readonly dirty = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private produced = false

  constructor(
    private readonly thread: HomeChatThread,
    private readonly publish: (entry: HomeChatEntry) => void
  ) {}

  userMessage(
    text: string,
    origin: 'user' | 'notice' | 'system',
    source?: HomeChatNoticeSource
  ): HomeChatThreadItem {
    const ord = this.thread.nextOrd()
    const item = this.thread.append({
      type: 'user',
      ord,
      text,
      origin,
      ...(source ? { source } : {})
    })
    if (origin === 'user') {
      this.emitNew(item.id, ord, { kind: 'user', text, delivery: 'delivered' }, item.at)
    } else if (origin === 'notice') {
      this.emitNew(item.id, ord, { kind: 'notice', source: source ?? 'job', text }, item.at)
    }
    return item
  }

  text(delta: string): void {
    this.stream('text', delta)
  }

  thinking(delta: string): void {
    this.stream('thinking', delta)
  }

  /** The model moved on from the block it was streaming. */
  settleText(): void {
    const open = this.open
    if (!open) {
      return
    }
    this.open = null
    if (open.part.kind === 'thinking') {
      open.part.durationMs = Date.now() - open.startedAt
    }
    this.patch<TextEntry>(open.part.id, {
      text: open.part.text,
      streaming: false,
      ...(open.part.kind === 'thinking' ? { durationMs: open.part.durationMs } : {})
    })
  }

  /** Whether the model has said or done anything this turn. */
  hasOutput(): boolean {
    return this.produced
  }

  hasCall(callId: string): boolean {
    return this.callParts.has(callId)
  }

  entryIdForCall(callId: string): string | undefined {
    return this.callParts.get(callId)?.id
  }

  /** Unanswered calls of this turn, oldest first; CLI drivers match their tool requests against it. */
  pendingCalls(): RecordedToolCall[] {
    return [...this.callParts.values()]
      .filter((part) => !this.answered.has(part.callId))
      .map(({ callId, tool, input }) => ({ callId, tool, input }))
  }

  toolCall(call: RecordedToolCall): void {
    if (this.callParts.has(call.callId)) {
      return
    }
    this.settleText()
    this.produced = true
    const part: HomeChatToolCallPart = {
      id: randomUUID(),
      ord: this.thread.nextOrd(),
      at: Date.now(),
      kind: 'tool_call',
      callId: call.callId,
      tool: call.tool,
      input: call.input
    }
    this.parts.push(part)
    this.callParts.set(call.callId, part)
    if (!HIDDEN_TOOL_CALLS.has(call.tool)) {
      this.emitNew(
        part.id,
        part.ord,
        { kind: 'tool', tool: call.tool, input: call.input, status: 'running' },
        part.at
      )
    }
  }

  toolStatus(
    callId: string,
    patch: { status: HomeChatToolStatus; approvalReason?: string; machine?: string }
  ): void {
    const part = this.callParts.get(callId)
    if (!part) {
      return
    }
    if (patch.approvalReason) {
      part.approvalReason = patch.approvalReason
    }
    this.patch<ToolEntry>(part.id, patch)
  }

  /** Close the model's current round; a round with nothing in it leaves no item. */
  endRound(stop: HomeChatRoundStop): void {
    this.settleText()
    const parts = this.parts.filter((part) => part.kind === 'tool_call' || part.text.trim())
    this.parts = []
    if (parts.length > 0) {
      this.thread.append({ type: 'assistant', parts, stop })
    }
  }

  toolResult(result: {
    callId: string
    tool: string
    content: string
    outcome: HomeChatToolOutcome
    machine?: string
    durationMs?: number
  }): void {
    if (this.answered.has(result.callId)) {
      return
    }
    this.answered.add(result.callId)
    // The call must be in the log before its result.
    if (this.parts.some((part) => part.kind === 'tool_call' && part.callId === result.callId)) {
      this.endRound('tool_calls')
    }
    this.thread.append({
      type: 'tool_result',
      callId: result.callId,
      tool: result.tool,
      content: result.content,
      outcome: result.outcome,
      ...(result.machine ? { machine: result.machine } : {}),
      ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {})
    })
    const part = this.callParts.get(result.callId)
    if (part) {
      this.patch<ToolEntry>(part.id, {
        status: toolStatusForOutcome(result.outcome),
        output: result.content.slice(0, MAX_UI_OUTPUT_CHARS),
        ...(result.machine ? { machine: result.machine } : {}),
        ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {})
      })
    }
  }

  event(event: HomeChatThreadEvent): void {
    const ord = this.thread.nextOrd()
    const item = this.thread.append({ type: 'event', ord, event })
    this.emitNew(item.id, ord, event, item.at)
  }

  /** `ord` places the divider above a message that is already in the thread. */
  compaction(
    summary: string,
    keepFromSeq: number,
    auto: boolean,
    ord = this.thread.nextOrd()
  ): void {
    const item = this.thread.append({ type: 'compaction', ord, summary, keepFromSeq, auto })
    this.emitNew(item.id, ord, { kind: 'compaction', summary, auto }, item.at)
  }

  /**
   * The single way a turn ends, however it ends: nothing stays streaming, the partial round is kept,
   * and every call still waiting is marked interrupted for the user. The log is left as is; replay
   * repairs unanswered calls.
   */
  finish(stop: HomeChatRoundStop): void {
    this.endRound(stop)
    for (const part of this.callParts.values()) {
      if (!this.answered.has(part.callId)) {
        this.patch<ToolEntry>(part.id, { status: 'error', output: INTERRUPTED_TOOL_TEXT })
      }
    }
    this.flush()
  }

  private stream(kind: 'text' | 'thinking', delta: string): void {
    if (!delta) {
      return
    }
    if (this.open && this.open.part.kind !== kind) {
      this.settleText()
    }
    this.produced = true
    if (!this.open) {
      const at = Date.now()
      const part = { id: randomUUID(), ord: this.thread.nextOrd(), at, kind, text: '' }
      this.parts.push(part)
      this.open = { part, startedAt: at }
      this.emitNew(
        part.id,
        part.ord,
        { kind: kind === 'text' ? 'assistant' : 'thinking', text: '', streaming: true },
        at
      )
    }
    this.open.part.text += delta
    const entry = this.live.get(this.open.part.id)
    if (entry && (entry.kind === 'assistant' || entry.kind === 'thinking')) {
      this.live.set(entry.id, { ...entry, text: this.open.part.text, rev: entry.rev + 1 })
      this.dirty.add(entry.id)
      this.timer ??= setTimeout(() => this.flush(), STREAM_PUBLISH_INTERVAL_MS)
    }
  }

  private emitNew(id: string, ord: number, fields: EntryFields, at = Date.now()): void {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: fields is an entry without the recorder-owned id/rev/at/ord.
    const entry = { ...fields, id, rev: 1, at, ord } as HomeChatEntry
    this.live.set(id, entry)
    this.send(entry)
  }

  private patch<E extends HomeChatEntry>(
    id: string,
    patch: Partial<Omit<E, 'id' | 'rev' | 'at' | 'ord' | 'kind'>>
  ): void {
    const entry = this.live.get(id)
    if (!entry) {
      return
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: callers patch an entry of the kind they created.
    const next = { ...entry, ...patch, rev: entry.rev + 1 } as HomeChatEntry
    this.live.set(id, next)
    this.dirty.delete(id)
    this.send(next)
  }

  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    for (const id of this.dirty) {
      const entry = this.live.get(id)
      if (entry) {
        this.send(entry)
      }
    }
    this.dirty.clear()
  }

  private send(entry: HomeChatEntry): void {
    this.thread.upsertEntry(entry)
    this.publish(entry)
  }
}
