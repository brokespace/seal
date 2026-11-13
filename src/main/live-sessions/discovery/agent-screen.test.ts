import { describe, expect, it } from 'vitest'
import { parseAgentScreen, screenAcceptsInput } from './agent-screen'

const RULE = '\u2500'.repeat(40)

describe('parseAgentScreen', () => {
  it('reads an empty Claude Code prompt box as free', () => {
    const screen = parseAgentScreen(
      ['● Done.', '', RULE, '\u276f ', RULE, '  ? for shortcuts'].join('\n')
    )
    expect(screen).toEqual({ promptBox: true, draft: '', approval: null })
    expect(screenAcceptsInput(screen)).toBe(true)
  })

  it('treats typed text as a draft but dim hint text as empty', () => {
    const typed = parseAgentScreen([RULE, '\u276f fix the build', RULE].join('\n'))
    expect(typed.draft).toBe('fix the build')
    expect(screenAcceptsInput(typed)).toBe(false)

    const hint = parseAgentScreen(
      [RULE, '\u276f \u001b[2mPress up to edit queued messages\u001b[0m', RULE].join('\n')
    )
    expect(hint.draft).toBe('')
    expect(screenAcceptsInput(hint)).toBe(true)
  })

  it('reads a Claude Code permission dialog and its numbered options', () => {
    const screen = parseAgentScreen(
      [
        `\u256d${RULE}\u256e`,
        '\u2502 Bash command                              \u2502',
        '\u2502   rm -rf dist                             \u2502',
        '\u2502 Do you want to proceed?                   \u2502',
        '\u2502 \u276f 1. Yes                                  \u2502',
        "\u2502   2. Yes, and don't ask again for rm      \u2502",
        '\u2502   3. No, and tell Claude what to do differently (esc) \u2502',
        `\u2570${RULE}\u256f`
      ].join('\n')
    )
    expect(screen.promptBox).toBe(false)
    expect(screen.approval).toEqual({
      question: 'Do you want to proceed?',
      options: [
        { id: '1', label: 'Yes', keys: '1' },
        { id: '2', label: "Yes, and don't ask again for rm", keys: '2' },
        { id: '3', label: 'No, and tell Claude what to do differently', keys: '3' }
      ]
    })
  })

  it('reads a Codex approval and its bare composer', () => {
    const approval = parseAgentScreen(
      [
        'Would you like to run the following command?',
        '  $ pnpm test',
        '\u203a 1. Yes, proceed (y)',
        "  2. Yes, and don't ask again for this command (a)",
        '  3. No, and tell Codex what to do differently (esc)'
      ].join('\n')
    )
    expect(approval.approval?.question).toBe('Would you like to run the following command?')
    expect(approval.approval?.options.map((o) => o.label)).toEqual([
      'Yes, proceed',
      "Yes, and don't ask again for this command",
      'No, and tell Codex what to do differently'
    ])

    const composer = parseAgentScreen(
      ['• Ran tests', '', '\u203a \u001b[2mAsk Codex to do anything\u001b[0m'].join('\n')
    )
    expect(composer).toEqual({ promptBox: true, draft: '', approval: null })
  })

  it('reports no prompt box while the screen shows something else', () => {
    expect(parseAgentScreen('$ ls\nREADME.md\n$ ').promptBox).toBe(false)
  })
})
