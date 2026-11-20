// Where the words, quotes and values of a shell command line are, by offset. Offsets and not
// unquoted text, so a caller can replace one part and leave every other byte as it was.
// POSIX quoting is assumed; a Windows command line that quotes differently still splits at spaces.

export type Span = { start: number; end: number }
/** `literal`: single-quoted, so `$NAME` in it is text and not a reference. */
export type Value = Span & { literal: boolean }

const OUTSIDE = 0
const IN_SINGLE = 1
const IN_DOUBLE = 2
const DELIMITER = 3

const UNQUOTED_BREAK = /[\s;|&()]/
const QUOTED_BREAK = /[\s&,;}\\]/

/** What encloses each character of a command; `shellCommands` fills it. */
export function commandQuoting(command: string): Uint8Array {
  return new Uint8Array(command.length)
}

/** The words of each simple command in `text`, which starts at `base` of the whole command. */
export function shellCommands(text: string, base: number, quoting?: Uint8Array): Span[][] {
  const commands: Span[][] = []
  let words: Span[] = []
  let start = -1
  let quote = ''
  const endWord = (end: number, endsCommand: boolean): void => {
    if (start >= 0) {
      words.push({ start: base + start, end: base + end })
      start = -1
    }
    if (endsCommand && words.length > 0) {
      commands.push(words)
      words = []
    }
  }
  for (let at = 0; at < text.length; at++) {
    const char = text.charAt(at)
    if (quote) {
      if (char === quote) {
        quoting?.fill(DELIMITER, at, at + 1)
        quote = ''
        continue
      }
      const escaped = quote === '"' && char === '\\' ? 1 : 0
      quoting?.fill(quote === '"' ? IN_DOUBLE : IN_SINGLE, at, at + 1 + escaped)
      at += escaped
    } else if (char === '\\') {
      const lineBreak = /^\r?\n/.exec(text.slice(at + 1, at + 3))
      if (lineBreak) {
        endWord(at, false)
      } else if (start < 0) {
        start = at
      }
      at += lineBreak ? lineBreak[0].length : 1
    } else if (UNQUOTED_BREAK.test(char)) {
      endWord(at, char !== ' ' && char !== '\t')
    } else {
      start = start < 0 ? at : start
      if (char === '"' || char === "'") {
        quoting?.fill(DELIMITER, at, at + 1)
        quote = char
      }
    }
  }
  endWord(text.length, true)
  return commands
}

/** The inside of a span that is one quoted string, else the span. */
export function unquoted(command: string, span: Span): Value {
  const quote = command.charAt(span.start)
  const wrapped =
    span.end - span.start >= 2 &&
    (quote === '"' || quote === "'") &&
    command.charAt(span.end - 1) === quote
  return wrapped
    ? { start: span.start + 1, end: span.end - 1, literal: quote === "'" }
    : { ...span, literal: false }
}

/** Where unquoted text from `at` stops: the end of its shell word, or of its part of a string. */
function runEnd(command: string, quoting: Uint8Array, at: number, around: number): number {
  let end = at
  while (end < command.length) {
    const here = quoting.at(end) ?? OUTSIDE
    const char = command.charAt(end)
    const breaks =
      around === OUTSIDE
        ? here === OUTSIDE && UNQUOTED_BREAK.test(char)
        : here !== around || QUOTED_BREAK.test(char)
    if (breaks) {
      break
    }
    end++
  }
  return end
}

/** The value written from `at`: inside its quotes when it has them, else up to a break. */
export function valueAfter(
  command: string,
  quoting: Uint8Array,
  at: number
): Value & { quoted: boolean } {
  const around = quoting.at(at) ?? OUTSIDE
  const escaped = command.charAt(at) === '\\' && /["']/.test(command.charAt(at + 1))
  const quote = command.charAt(escaped ? at + 1 : at)
  if (quote !== '"' && quote !== "'") {
    return { start: at, end: runEnd(command, quoting, at, around), literal: false, quoted: false }
  }
  const stringEnd = (): number => {
    const closer = quoting.indexOf(DELIMITER, at + 1)
    return closer === -1 ? command.length : closer
  }
  if (around === DELIMITER) {
    const before = at > 0 ? quoting.at(at - 1) : OUTSIDE
    // The quote that closes the string the label sits in: `rg "password: " src` has no value.
    if (before === IN_SINGLE || before === IN_DOUBLE) {
      return { start: at, end: at, literal: false, quoted: true }
    }
    const end = stringEnd()
    // `'pa'"'"'ss'` is one value in three strings: take the whole word.
    return quoting.at(end + 1) === DELIMITER
      ? { start: at, end: runEnd(command, quoting, at, OUTSIDE), literal: true, quoted: true }
      : { start: at + 1, end, literal: quote === "'", quoted: true }
  }
  // A quote that is text inside the enclosing string: its value may not run past that string.
  const open = at + (escaped ? 2 : 1)
  const close = command.indexOf(escaped ? `\\${quote}` : quote, open)
  const inside =
    close !== -1 && (around === OUTSIDE || !quoting.subarray(open, close).includes(DELIMITER))
  const end = inside ? close : stringEnd()
  return { start: open, end, literal: false, quoted: true }
}
