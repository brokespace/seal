// Whether an agent's final reply leaves a question with the user, as far as its text shows.

/**
 * asks     its last line is a question
 * tells    nothing in its closing lines asks for anything
 * unclear  it asks somewhere near the end, or in words rather than a question mark: the utility
 *          model decides (docs/session-status.md)
 */
export type ReplyAsk = 'asks' | 'tells' | 'unclear'

const CLOSING_CHARS = 600
const CLOSING_LINES = 4
const TRAILING_MARKUP = /[\s*_`)\]"'\u201d\u2019]+$/

/** Words that hand the next move to the user without a question mark. */
const REQUEST =
  /\b(let me know|should i|shall i|do you want|would you like|want me to|which (one|option|approach|of)|please (confirm|choose|advise|clarify|decide|pick|tell me)|what do you think|your call|up to you|ok(ay)? to proceed|awaiting your|waiting (for|on) your|need your (input|decision|approval|confirmation|go-ahead)|before i (proceed|continue|go ahead))\b/i

/** Code, links and quoted text hold question marks that ask nothing. */
function prose(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\bhttps?:\/\/\S+/g, ' ')
}

export function replyAskOf(text: string | null): ReplyAsk {
  const lines = prose(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const last = lines.at(-1)
  if (!last) {
    return 'tells'
  }
  if (last.replace(TRAILING_MARKUP, '').endsWith('?')) {
    return 'asks'
  }
  const closing = lines.slice(-CLOSING_LINES).join('\n').slice(-CLOSING_CHARS)
  return closing.includes('?') || REQUEST.test(closing) ? 'unclear' : 'tells'
}
