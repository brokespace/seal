// Where an agent compacts on its own, from the configuration on the host it runs on. The agent's
// own report (Claude's `get_context_usage`) outranks this wherever one exists.
import { parse as parseToml } from 'smol-toml'
import { isRecord } from '../agent-status/child-work/agent-status-child-work-value-guards'

export type ClaudeAutoCompactSettings = {
  provider: 'claude'
  disabled?: true
  /** `CLAUDE_CODE_AUTO_COMPACT_WINDOW` from the settings' `env`: outranks both settings below. */
  envWindow?: number
  /** `modelSettings.<model>.autoCompactWindow`, keyed by the model id without suffixes. */
  modelWindows?: Readonly<Record<string, number>>
  window?: number
  /** `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`: compacts earlier, never later. */
  percent?: number
}

export type CodexAutoCompactSettings = {
  provider: 'codex'
  /** `model_auto_compact_token_limit`; Codex's own default is not known outside it. */
  tokenLimit?: number
}

export type AgentAutoCompactSettings = ClaudeAutoCompactSettings | CodexAutoCompactSettings

// Claude Code 2.1: the window is clamped to [100k, model window]; a summary's output and a buffer come off it.
const CLAUDE_MIN_AUTO_COMPACT_WINDOW = 100_000
const CLAUDE_SUMMARY_OUTPUT_RESERVE = 20_000
const CLAUDE_AUTO_COMPACT_BUFFER = 13_000

/** `400000`, `"400k"`, `"1m"`; `"auto"` and anything else is no setting. */
function tokenCount(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
  }
  const m = typeof value === 'string' ? /^\s*(\d+(?:\.\d+)?)\s*([km])?\s*$/iu.exec(value) : null
  if (!m) {
    return undefined
  }
  const unit = m[2]?.toLowerCase()
  const tokens = Number(m[1]) * (unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1)
  return tokens > 0 ? Math.floor(tokens) : undefined
}

function isOn(value: unknown): boolean {
  return value === true || value === 1 || (typeof value === 'string' && /^(1|true)$/iu.test(value))
}

/** `claude-opus-5-5[1m]` and `claude-opus-5-5-20260101` name the same settings as `claude-opus-5-5`. */
export function claudeSettingsModelKey(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/u, '')
    .replace(/-\d{8}$/u, '')
}

/**
 * A Claude config root's `settings.json`, and whether its global config turned auto-compact off.
 * Null text is a root with no settings that mention compaction: the defaults apply.
 */
export function parseClaudeAutoCompactSettings(
  text: string | null,
  globallyDisabled = false
): ClaudeAutoCompactSettings {
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }
  const settings = isRecord(parsed) ? parsed : {}
  const env = isRecord(settings.env) ? settings.env : {}
  const modelWindows = Object.fromEntries(
    Object.entries(isRecord(settings.modelSettings) ? settings.modelSettings : {}).flatMap(
      ([model, entry]) => {
        const window = isRecord(entry) ? tokenCount(entry.autoCompactWindow) : undefined
        return window === undefined ? [] : [[claudeSettingsModelKey(model), window]]
      }
    )
  )
  const envWindow = tokenCount(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW)
  const window = tokenCount(settings.autoCompactWindow)
  const percent = Number(env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE)
  const disabled =
    globallyDisabled ||
    settings.autoCompactEnabled === false ||
    isOn(env.DISABLE_AUTO_COMPACT) ||
    isOn(env.DISABLE_COMPACT)
  return {
    provider: 'claude',
    ...(disabled ? { disabled: true as const } : {}),
    ...(envWindow === undefined ? {} : { envWindow }),
    ...(Object.keys(modelWindows).length > 0 ? { modelWindows } : {}),
    ...(window === undefined ? {} : { window }),
    ...(percent >= 1 && percent <= 100 ? { percent } : {})
  }
}

/** Codex's effective config, as `config/read` answers it or as `config.toml` holds it. */
export function codexAutoCompactSettingsOf(config: unknown): CodexAutoCompactSettings {
  const top = isRecord(config) ? config : {}
  const profiles = isRecord(top.profiles) ? top.profiles : {}
  const profile =
    typeof top.profile === 'string' && isRecord(profiles[top.profile]) ? profiles[top.profile] : {}
  const tokenLimit =
    tokenCount(isRecord(profile) ? profile.model_auto_compact_token_limit : undefined) ??
    tokenCount(top.model_auto_compact_token_limit)
  return { provider: 'codex', ...(tokenLimit === undefined ? {} : { tokenLimit }) }
}

export function parseCodexAutoCompactSettings(text: string | null): CodexAutoCompactSettings {
  try {
    return codexAutoCompactSettingsOf(text ? parseToml(text) : null)
  } catch {
    return { provider: 'codex' }
  }
}

/** The used-token count at which the agent compacts on its own; null when it never does or nobody can tell. */
export function autoCompactAtTokens(
  settings: AgentAutoCompactSettings,
  model: string | undefined,
  windowTokens: number
): number | null {
  if (windowTokens <= 0) {
    return null
  }
  if (settings.provider === 'codex') {
    return settings.tokenLimit === undefined ? null : Math.min(settings.tokenLimit, windowTokens)
  }
  if (settings.disabled) {
    return null
  }
  const configured =
    settings.envWindow ??
    (model ? settings.modelWindows?.[claudeSettingsModelKey(model)] : undefined) ??
    settings.window
  const window =
    configured === undefined
      ? windowTokens
      : Math.min(Math.max(configured, CLAUDE_MIN_AUTO_COMPACT_WINDOW), windowTokens)
  const effective = window - CLAUDE_SUMMARY_OUTPUT_RESERVE
  const threshold = effective - CLAUDE_AUTO_COMPACT_BUFFER
  const at =
    settings.percent === undefined
      ? threshold
      : Math.min(Math.floor((effective * settings.percent) / 100), threshold)
  return at > 0 ? at : null
}
