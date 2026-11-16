// What each agent's transcript records say about context usage, and the fold that turns those
// samples into the ring's input. Agents with no reader here show no indicator.
import { contextTokensFromUsage } from '../../agent-session/agent-session-context-usage'
import {
  claudeDefaultContextWindow,
  claudeTokenUsage
} from '../../agent-session/agent-session-context-usage-claude'
import { isRecord } from '../../agent-status/child-work/agent-status-child-work-value-guards'
import type { NativeChatTranscriptAgent } from '../../native-chat/native-chat-agent-support'
import { isNativeChatCompactionBoundary } from '../../native-chat/native-chat-context-usage'
import { unmeasuredContextUsage } from '../../native-chat/native-chat-context-usage-state'
import type { NativeChatContextUsageSummary } from '../../native-chat/native-chat-context-usage-summary'
import type { NativeChatMessage } from '../../native-chat/native-chat-types'
import type { AgentSessionContextSample } from './agent-session-adapter'

type ContextSampleReader = (record: unknown) => AgentSessionContextSample | null

function positiveCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function modelName(value: unknown): string | null {
  const model = typeof value === 'string' ? value.trim() : ''
  return model || null
}

function recordedAt(timestamp: unknown): Pick<AgentSessionContextSample, 'at'> {
  const at = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN
  return Number.isFinite(at) ? { at } : {}
}

function claudeUsageSample(
  usage: Parameters<typeof contextTokensFromUsage>[0],
  model: string | null
): AgentSessionContextSample | null {
  const usedTokens = contextTokensFromUsage(usage)
  if (usedTokens <= 0) {
    return null
  }
  return {
    usedTokens,
    // A transcript names no window; see `claudeDefaultContextWindow` for the rule.
    windowTokens: claudeDefaultContextWindow(model, usedTokens),
    ...(model ? { model } : {})
  }
}

/** The main thread's responses size the context; a subagent's measure its own window. */
function claudeContextSampleOf(record: unknown): AgentSessionContextSample | null {
  if (!isRecord(record) || record.isSidechain === true) {
    return null
  }
  if (record.type === 'user' && record.isCompactSummary === true) {
    return { compacted: true, ...recordedAt(record.timestamp) }
  }
  if (record.type !== 'assistant' || !isRecord(record.message)) {
    return null
  }
  const usage = claudeTokenUsage(record.message.usage)
  const sample = usage ? claudeUsageSample(usage, modelName(record.message.model)) : null
  return sample ? { ...sample, ...recordedAt(record.timestamp) } : null
}

/**
 * Codex states both numbers on one `token_count` record. A null window is unknown, as in Codex
 * chat. The model is on the `turn_context` record before it, and only top-level `compacted`
 * records count: Codex writes an `item_completed` for the same compaction.
 */
function codexContextSampleOf(record: unknown): AgentSessionContextSample | null {
  if (!isRecord(record)) {
    return null
  }
  if (record.type === 'compacted') {
    return { compacted: true, ...recordedAt(record.timestamp) }
  }
  const payload = isRecord(record.payload) ? record.payload : null
  if (record.type === 'turn_context') {
    const model = modelName(payload?.model)
    return model ? { model } : null
  }
  const info = payload?.type === 'token_count' && isRecord(payload.info) ? payload.info : null
  if (record.type !== 'event_msg' || !info) {
    return null
  }
  const last = isRecord(info.last_token_usage) ? info.last_token_usage : null
  const usedTokens = positiveCount(last?.total_tokens)
  if (usedTokens === null) {
    return null
  }
  const windowTokens = positiveCount(info.model_context_window)
  return {
    usedTokens,
    ...(windowTokens === null ? {} : { windowTokens }),
    ...recordedAt(record.timestamp)
  }
}

const CONTEXT_SAMPLE_READERS: Partial<Record<NativeChatTranscriptAgent, ContextSampleReader>> = {
  claude: claudeContextSampleOf,
  codex: codexContextSampleOf
}

/** Codex records its own count and window; Claude's window is the default for its model. */
const EXACT_CONTEXT_SAMPLES: ReadonlySet<NativeChatTranscriptAgent> = new Set(['codex'])

/** Decoders that keep a response's usage and model on its message. */
const MESSAGE_USAGE_DECODERS: ReadonlySet<NativeChatTranscriptAgent> = new Set(['claude'])

/** The adapter's `transcript.usageOf` for a decoder family, when its transcripts carry usage. */
export function contextSampleReaderOf(
  decoder: NativeChatTranscriptAgent | null
): ContextSampleReader | undefined {
  return decoder ? CONTEXT_SAMPLE_READERS[decoder] : undefined
}

/**
 * The same reading from a decoded chat message, for a view that holds messages rather than
 * records. Only decoders that keep usage on their messages answer; the rest read records.
 */
export function contextSampleOfMessage(
  decoder: NativeChatTranscriptAgent | null,
  message: NativeChatMessage
): AgentSessionContextSample | null {
  if (!decoder || !MESSAGE_USAGE_DECODERS.has(decoder)) {
    return null
  }
  const at = message.timestamp === null ? {} : { at: message.timestamp }
  if (isNativeChatCompactionBoundary(message)) {
    return { compacted: true, ...at }
  }
  const sample =
    message.role === 'assistant' && message.usage
      ? claudeUsageSample(message.usage, message.model ?? null)
      : null
  return sample ? { ...sample, ...at } : null
}

export type ContextSampleFoldOptions = {
  /** The samples cover the session from its start, so the compaction count is whole. */
  complete?: boolean
  /** The provider stated the numbers, rather than Seal sizing them against a default window. */
  exact?: boolean
}

/**
 * Samples in transcript order to the session's `context`. Null when nothing was sampled. A
 * compaction leaves the size unmeasured until the next response restates it.
 */
export function foldContextSamples(
  samples: Iterable<AgentSessionContextSample>,
  { complete = false, exact = false }: ContextSampleFoldOptions = {}
): NativeChatContextUsageSummary | null {
  let sampled = false
  let model: string | undefined
  let measured: { usedTokens: number; windowTokens?: number; model?: string; at?: number } | null =
    null
  let compactions = 0
  let lastCompactedAt: number | undefined
  for (const sample of samples) {
    sampled = true
    model = sample.model ?? model
    if (sample.compacted) {
      compactions += 1
      lastCompactedAt = sample.at ?? lastCompactedAt
      measured = null
    }
    if (sample.usedTokens === undefined) {
      continue
    }
    // A window does not shrink under one model: a context seen past the default stays in the larger one.
    const held = measured?.model === model ? measured?.windowTokens : undefined
    const windowTokens =
      sample.windowTokens !== undefined && held !== undefined
        ? Math.max(sample.windowTokens, held)
        : sample.windowTokens
    measured = {
      usedTokens: sample.usedTokens,
      ...(windowTokens === undefined ? {} : { windowTokens }),
      ...(model === undefined ? {} : { model }),
      ...(sample.at === undefined ? {} : { at: sample.at })
    }
  }
  if (!sampled) {
    return null
  }
  const known = {
    ...(model === undefined ? {} : { model }),
    ...(complete ? { compactions } : {}),
    ...(lastCompactedAt === undefined ? {} : { lastCompactedAt })
  }
  if (!measured || measured.windowTokens === undefined) {
    return unmeasuredContextUsage(known)
  }
  return {
    usedTokens: measured.usedTokens,
    windowTokens: measured.windowTokens,
    percentage: Math.round((measured.usedTokens / measured.windowTokens) * 100),
    estimated: !exact,
    rows: [],
    ...known,
    ...(measured.at === undefined ? {} : { updatedAt: measured.at })
  }
}

/**
 * A transcript's parsed records to the session's `context`. Null for agents that record no usage;
 * unmeasured until a record carries some.
 */
export function contextUsageOfRecords(
  decoder: NativeChatTranscriptAgent | null,
  records: Iterable<unknown>,
  options: Pick<ContextSampleFoldOptions, 'complete'> = {}
): NativeChatContextUsageSummary | null {
  const read = contextSampleReaderOf(decoder)
  if (!decoder || !read) {
    return null
  }
  return (
    foldContextSamples(samplesOf(records, read), {
      ...options,
      exact: EXACT_CONTEXT_SAMPLES.has(decoder)
    }) ?? unmeasuredContextUsage(options.complete ? { compactions: 0 } : {})
  )
}

function* samplesOf(
  records: Iterable<unknown>,
  read: ContextSampleReader
): Generator<AgentSessionContextSample> {
  for (const record of records) {
    const sample = read(record)
    if (sample) {
      yield sample
    }
  }
}

/**
 * Decoded chat messages to the same `context`, for the chat view of a CLI session. Null when the
 * decoder keeps no usage on its messages; unmeasured until a response carries some.
 */
export function contextUsageOfMessages(
  decoder: NativeChatTranscriptAgent | null,
  messages: Iterable<NativeChatMessage>
): NativeChatContextUsageSummary | null {
  if (!decoder || !MESSAGE_USAGE_DECODERS.has(decoder)) {
    return null
  }
  return (
    foldContextSamples(messageSamplesOf(decoder, messages), {
      exact: EXACT_CONTEXT_SAMPLES.has(decoder)
    }) ?? unmeasuredContextUsage()
  )
}

function* messageSamplesOf(
  decoder: NativeChatTranscriptAgent,
  messages: Iterable<NativeChatMessage>
): Generator<AgentSessionContextSample> {
  for (const message of messages) {
    const sample = contextSampleOfMessage(decoder, message)
    if (sample) {
      yield sample
    }
  }
}
