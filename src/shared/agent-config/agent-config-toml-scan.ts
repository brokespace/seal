import { parse } from 'smol-toml'

/** One `key = value` statement; `end` is the line after it, since values can span lines. */
export type TomlStatement = { path: string[]; start: number; end: number }

export type TomlSection = {
  /** Empty for the keys above the first table header. */
  path: string[]
  /** Declared with `[[...]]`, or nested under such a table. */
  array: boolean
  /** Line of the `[header]`; -1 for the root. */
  header: number
  /** The line after the section's last statement. */
  end: number
  statements: TomlStatement[]
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/
const MAX_STATEMENT_LINES = 5_000

export function tomlKeyText(key: string): string {
  return BARE_KEY.test(key) ? key : JSON.stringify(key)
}

/** Reads a dotted key up to `stop`; returns null when the text is not a key. */
function readKeyPath(text: string, stop: string): { path: string[]; rest: string } | null {
  const path: string[] = []
  let index = 0
  for (;;) {
    while (text[index] === ' ' || text[index] === '\t') {
      index += 1
    }
    const quote = text[index]
    if (quote === '"' || quote === "'") {
      let close = index + 1
      while (close < text.length && text[close] !== quote) {
        close += quote === '"' && text[close] === '\\' ? 2 : 1
      }
      if (close >= text.length) {
        return null
      }
      const raw = text.slice(index, close + 1)
      try {
        path.push(quote === '"' ? String(JSON.parse(raw)) : raw.slice(1, -1))
      } catch {
        return null
      }
      index = close + 1
    } else {
      const bare = /^[A-Za-z0-9_-]+/.exec(text.slice(index))?.[0]
      if (!bare) {
        return null
      }
      path.push(bare)
      index += bare.length
    }
    while (text[index] === ' ' || text[index] === '\t') {
      index += 1
    }
    if (text[index] === '.') {
      index += 1
      continue
    }
    return text.startsWith(stop, index) ? { path, rest: text.slice(index + stop.length) } : null
  }
}

function parses(text: string): boolean {
  try {
    parse(text)
    return true
  } catch {
    return false
  }
}

function statementEnd(lines: readonly string[], start: number): number {
  const limit = Math.min(lines.length, start + MAX_STATEMENT_LINES)
  for (let end = start + 1; end <= limit; end += 1) {
    if (parses(lines.slice(start, end).join('\n'))) {
      return end
    }
  }
  throw new Error(`Line ${start + 1} is not a complete TOML statement`)
}

/** Splits a TOML file into its tables and statements by line, without changing a byte of it. */
export function scanToml(lines: readonly string[]): TomlSection[] {
  const root: TomlSection = { path: [], array: false, header: -1, end: 0, statements: [] }
  const sections = [root]
  let current = root
  let leading = true
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line === '' || line.startsWith('#')) {
      // A new root key goes under the file's opening comment, not above it.
      if (leading && line !== '') {
        root.end = index + 1
      }
      continue
    }
    leading = false
    if (line.startsWith('[')) {
      const array = line.startsWith('[[')
      const header = readKeyPath(line.slice(array ? 2 : 1), array ? ']]' : ']')
      if (!header) {
        throw new Error(`Line ${index + 1} is not a table header`)
      }
      const inArray =
        array ||
        sections.some(
          (section) =>
            section.array &&
            section.path.length <= header.path.length &&
            section.path.every((key, at) => header.path[at] === key)
        )
      current = { path: header.path, array: inArray, header: index, end: index + 1, statements: [] }
      sections.push(current)
      continue
    }
    const key = readKeyPath(line, '=')
    if (!key) {
      throw new Error(`Line ${index + 1} is not a TOML statement`)
    }
    const end = statementEnd(lines, index)
    current.statements.push({ path: key.path, start: index, end })
    current.end = end
    index = end - 1
  }
  return sections
}
