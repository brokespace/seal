import { describe, expect, it } from 'vitest'
import {
  autoCompactAtTokens,
  parseClaudeAutoCompactSettings,
  parseCodexAutoCompactSettings
} from './agent-auto-compact-settings'

const claudeAt = (settings: unknown, model: string, windowTokens = 1_000_000, off = false) =>
  autoCompactAtTokens(
    parseClaudeAutoCompactSettings(JSON.stringify(settings), off),
    model,
    windowTokens
  )

describe('Claude auto-compact point', () => {
  it('compacts a 1M model a summary and a buffer short of the configured window', () => {
    expect(claudeAt({ autoCompactWindow: 400_000 }, 'claude-opus-5-5')).toBe(367_000)
    expect(claudeAt({}, 'claude-opus-5-5')).toBe(967_000)
  })

  it("prefers the model's own window, then the env's over both", () => {
    const settings = {
      autoCompactWindow: 600_000,
      modelSettings: { 'claude-opus-5-5': { autoCompactWindow: '400k' } }
    }
    expect(claudeAt(settings, 'claude-opus-5-5[1m]')).toBe(367_000)
    expect(claudeAt(settings, 'claude-sonnet-5-5')).toBe(567_000)
    expect(
      claudeAt(
        { ...settings, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' } },
        'claude-opus-5-5'
      )
    ).toBe(267_000)
  })

  it('caps the window at the model and lets a percentage only compact earlier', () => {
    expect(claudeAt({ autoCompactWindow: '1m' }, 'claude-haiku-4-5', 200_000)).toBe(167_000)
    expect(
      claudeAt(
        { autoCompactWindow: 400_000, env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '50' } },
        'claude-opus-5-5'
      )
    ).toBe(190_000)
  })

  it('never compacts on its own once turned off', () => {
    expect(claudeAt({ autoCompactWindow: 400_000 }, 'claude-opus-5-5', 1_000_000, true)).toBeNull()
    expect(claudeAt({ env: { DISABLE_AUTO_COMPACT: '1' } }, 'claude-opus-5-5')).toBeNull()
  })
})

describe('Codex auto-compact point', () => {
  it('reads the limit of the profile in use over the top-level one', () => {
    const toml = [
      'model_auto_compact_token_limit = 300000',
      'profile = "deep"',
      '[profiles.deep]',
      'model_auto_compact_token_limit = 200000'
    ].join('\n')
    expect(autoCompactAtTokens(parseCodexAutoCompactSettings(toml), undefined, 272_000)).toBe(
      200_000
    )
  })

  it('says nothing without a configured limit', () => {
    expect(
      autoCompactAtTokens(parseCodexAutoCompactSettings('model = "x"'), undefined, 272_000)
    ).toBeNull()
  })
})
