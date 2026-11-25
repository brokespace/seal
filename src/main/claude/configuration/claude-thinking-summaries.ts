import { claudeVersionReaches } from '../cli-capabilities/claude-hook-event-versions'

// Since 2.1.89 an interactive Claude Code session asks the API for no thinking summary, so its transcript
// keeps each thought as a signature only. This user setting restores the summaries Active agents reads.
export const CLAUDE_THINKING_SUMMARIES_SETTING = 'showThinkingSummaries'

// Older CLIs reject the whole settings file on an unknown top-level key.
export const CLAUDE_THINKING_SUMMARIES_FIRST_VERSION = '2.1.89'

/** Asks Claude Code for summaries where the user has not chosen: their own `true` or `false` is kept. */
export function withClaudeThinkingSummaries<T extends Record<string, unknown>>(
  settings: T,
  agent: string,
  claudeVersion: string | null | undefined
): T {
  // Compatible CLIs share the installer but not the setting.
  return agent !== 'claude' ||
    CLAUDE_THINKING_SUMMARIES_SETTING in settings ||
    !claudeVersionReaches(claudeVersion, CLAUDE_THINKING_SUMMARIES_FIRST_VERSION)
    ? settings
    : { ...settings, [CLAUDE_THINKING_SUMMARIES_SETTING]: true }
}
