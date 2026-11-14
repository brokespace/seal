import { describe, expect, it } from 'vitest'
import { replyAskVerdict } from './reply-ask-task'

describe('replyAskVerdict', () => {
  it.each([
    ['ASKS', 'asks'],
    ['asks.', 'asks'],
    ['**TELLS**', 'tells'],
    ['Answer: TELLS', 'tells'],
    ['The agent asks its user to confirm.', 'asks'],
    ['', null],
    ['I cannot determine that.', null]
  ] as const)('%j → %s', (reply, verdict) => {
    expect(replyAskVerdict(reply)).toBe(verdict)
  })
})
