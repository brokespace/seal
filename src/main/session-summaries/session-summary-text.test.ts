import { describe, expect, it } from 'vitest'
import { cleanSummary, prepareSummaryInput } from './session-summary-text'

describe('prepareSummaryInput', () => {
  it('drops fenced code, terminal escapes and credentials, keeping the prose', () => {
    const input = prepareSummaryInput(
      [
        '\u001b[32mDone.\u001b[0m I updated the deploy script:',
        '```bash',
        'export TOKEN=abc',
        '```',
        'The key is api_key=sk-secret-value-123456 for now.',
        '~~~',
        'unterminated block'
      ].join('\n')
    )

    expect(input).toBe(
      'Done. I updated the deploy script:\n\nThe key is [redacted:labeled-kv] for now.'
    )
  })

  it('keeps the opening and the end of a long message', () => {
    const input = prepareSummaryInput(`START ${'filler '.repeat(800)}Should I deploy now?`)

    expect(input.length).toBeLessThan(2300)
    expect(input.startsWith('START filler')).toBe(true)
    expect(input.endsWith('Should I deploy now?')).toBe(true)
    expect(input).toContain('\n…\n')
  })
})

describe('cleanSummary', () => {
  it('keeps the first line without quotes, labels or markdown', () => {
    expect(cleanSummary('\n**Summary:** "Needs approval to run the migration."\nmore')).toBe(
      'Needs approval to run the migration.'
    )
  })

  it('cuts an over-long reply at a word boundary within 80 characters', () => {
    const summary = cleanSummary(
      'Refactored the authentication middleware and updated every caller across the whole monorepo to match'
    )

    expect(summary).toBe(
      'Refactored the authentication middleware and updated every caller across the…'
    )
  })

  it('returns null for an empty reply', () => {
    expect(cleanSummary('  \n ')).toBeNull()
  })
})
