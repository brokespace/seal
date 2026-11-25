// Claude's context accounting, for the structured host and for transcripts read without it.
import { isRecord } from '../agent-status/child-work/agent-status-child-work-value-guards'
import type { AgentSessionTokenUsage } from './agent-session-context-usage'

/**
 * The window a Claude model has when nothing states it. A transcript names the model without its
 * window. Claude 4.7 and later (with every Fable and Mythos model) serve 1M; older models serve
 * 200k unless `[1m]` asks for the beta, and a context already past 200k can only be a 1M window.
 * The SDK's own report and `modelUsage[].contextWindow` outrank this wherever they exist.
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

/** The first Claude generation whose every model serves 1M without asking. */
const CLAUDE_EXTENDED_BY_DEFAULT_SINCE = [4, 7] as const

/** `claude-opus-5-5`, `us.anthropic.claude-sonnet-4-5-20250929-v1:0`, `claude-haiku-4-5@20251001`. */
function claudeModelVersion(model: string): readonly [number, number] | 'extended' | null {
  const id = /claude-[a-z0-9.-]*/u.exec(model.toLowerCase())?.[0]
  if (!id) {
    return null
  }
  if (/^claude-(?:fable|mythos)(?:-|$)/u.test(id)) {
    return 'extended'
  }
  // A two-digit minor, never the eight-digit date some ids end with.
  const m = /^claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?![0-9])/u.exec(id)
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : null
}

/** Null where the model alone cannot tell: aliases, older models, and ids from elsewhere. */
export function claudeContextWindowHint(model: string): number | null {
  const trimmed = model.trim()
  if (/\[1m\]$/iu.test(trimmed)) {
    return CLAUDE_EXTENDED_CONTEXT_WINDOW_TOKENS
  }
  const version = claudeModelVersion(trimmed)
  if (version === null) {
    return null
  }
  const [major, minor] = CLAUDE_EXTENDED_BY_DEFAULT_SINCE
  return version === 'extended' ||
    version[0] > major ||
    (version[0] === major && version[1] >= minor)
    ? CLAUDE_EXTENDED_CONTEXT_WINDOW_TOKENS
    : null
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
