import { describe, expect, it } from 'vitest'
import { withClaudeThinkingSummaries } from './claude-thinking-summaries'

describe('withClaudeThinkingSummaries', () => {
  it('turns summaries on for a Claude Code that knows the setting, beside the other settings', () => {
    expect(withClaudeThinkingSummaries({ theme: 'dark' }, 'claude', '2.1.325')).toEqual({
      theme: 'dark',
      showThinkingSummaries: true
    })
  })

  it('keeps the choice a user already made', () => {
    expect(
      withClaudeThinkingSummaries({ showThinkingSummaries: false }, 'claude', '2.1.325')
    ).toEqual({ showThinkingSummaries: false })
  })

  it('leaves older or unknown Claude Code versions and compatible CLIs alone', () => {
    expect(withClaudeThinkingSummaries({}, 'claude', '2.1.88')).toEqual({})
    expect(withClaudeThinkingSummaries({}, 'claude', undefined)).toEqual({})
    expect(withClaudeThinkingSummaries({}, 'openclaude', '2.1.325')).toEqual({})
  })
})
