// Claude's context accounting, for the structured host and for transcripts read without it.
import { isRecord } from '../agent-status/child-work/agent-status-child-work-value-guards'
import type { AgentSessionTokenUsage } from './agent-session-context-usage'

/**
 * The window a Claude model has when nothing states it. A transcript names the model without its
 * window, and no per-model table exists: every current Claude model has 200k, and the 1M beta is
 * the one exception. So: `[1m]` on the model id means 1M, a context already past 200k can only be
 * a 1M window, and anything else is 200k. The SDK's own report and `modelUsage[].contextWindow`
 * outrank this wherever they exist.
 */
export const CLAUDE_DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000
export const CLAUDE_EXTENDED_CONTEXT_WINDOW_TOKENS = 1_000_000

function positiveCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** Synthetic responses report zero usage and cannot size the context. */
export function claudeTokenUsage(value: unknown): AgentSessionTokenUsage | null {
  if (!isRecord(value)) {
    return null
  }
  const usage = {
    inputTokens: positiveCount(value.input_tokens),
    cacheCreationInputTokens: positiveCount(value.cache_creation_input_tokens),
    cacheReadInputTokens: positiveCount(value.cache_read_input_tokens),
    outputTokens: positiveCount(value.output_tokens)
  }
  const total =
    usage.inputTokens +
    usage.cacheCreationInputTokens +
    usage.cacheReadInputTokens +
    usage.outputTokens
  return total > 0 ? usage : null
}

export function claudeContextWindowHint(model: string): number | null {
  // Bare names vary by provider and plan mode; only an explicit [1m] gives a reliable hint.
  if (!/\[1m\]$/iu.test(model.trim())) {
    return null
  }
  return CLAUDE_EXTENDED_CONTEXT_WINDOW_TOKENS
}

/** The window to measure a transcript's usage against, when only the model and the count are known. */
export function claudeDefaultContextWindow(
  model: string | null | undefined,
  usedTokens: number
): number {
  return (
    (model ? claudeContextWindowHint(model) : null) ??
    (usedTokens > CLAUDE_DEFAULT_CONTEXT_WINDOW_TOKENS
      ? CLAUDE_EXTENDED_CONTEXT_WINDOW_TOKENS
      : CLAUDE_DEFAULT_CONTEXT_WINDOW_TOKENS)
  )
}
