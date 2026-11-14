import { describe, expect, it } from 'vitest'
import { replyAskOf } from './reply-ask'

describe('replyAskOf', () => {
  it.each([
    ['Renamed OrderSummary to OrderReceipt in 23 files. Typecheck and tests pass.', 'tells'],
    ['I found two ways to fix this.\n\nWhich one do you want?', 'asks'],
    ['Done. Want me to open a PR?', 'asks'],
    // A question the reply goes on past, or a request without a question mark: only a reader can say.
    [
      'The deploy script can target staging or production. Should I go ahead with staging? I have not changed anything yet.',
      'unclear'
    ],
    ['All three migrations are written. Let me know which one to run first.', 'unclear'],
    ['The tests pass. Let me know if you want anything else.', 'unclear'],
    // Question marks in code and links are not questions to the user.
    ['Fixed the regex:\n```js\nconst optional = /colou?r/\n```\nThe lint passes now.', 'tells'],
    ['The docs are at https://example.com/search?q=retry and cover the backoff.', 'tells'],
    ['Used `value ?? fallback` where the config is missing.', 'tells'],
    ['', 'tells'],
    [null, 'tells']
  ] as const)('%j → %s', (reply, expected) => {
    expect(replyAskOf(reply)).toBe(expected)
  })
})
