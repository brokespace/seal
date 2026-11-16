// The judge is shown the command lines an agent ran. The prose redactor wipes every `NAME=value`
// line, which is evidence here, and knows nothing of flags, so credentials are found by where a
// shell puts them. A command with none must come back byte for byte: answers are keyed on it.
import { redactString } from '../observability/redactor'
import {
  commandQuoting,
  shellCommands,
  unquoted,
  valueAfter,
  type Span,
  type Value
} from './session-recap-command-words'

const MARK = '[redacted]'
const UNREADABLE_COMMAND = '[redacted:command]'
// Stands for the settled text before a gap, so `redactString` does not read the gap as a new line.
const GUARD = '\0'

type Edit = Span & { replacement: string }
/** Settles a span unless part of it already is. Without a replacement it stays as written. */
type Put = (start: number, end: number, replacement?: string) => boolean

const SECRET_NAME =
  /token(?!s(?![a-z])|iz)|secret|passw(?:or)?d|passphrase|credential|cookie|bearer|auth(?!or(?!iz))|(?:api|priv|private)_?key|session_?id|(?:^|_)(?:pass|sshpass|dsn)(?:_|$)|[a-z\d]_keys?(?:_|$)|(?:^|_)keys?_[a-z\d]|[a-z\d]_pwd$/
// `TOKEN_TTL` and `AUTH_URL` describe a credential and hold none.
const ABOUT_A_SECRET =
  /_(?:ttl|timeout|length|len|count|size|port|host|url|uri|endpoint|path|file|dir|type|mode|enabled|expiry|expires|algorithm|version|region)$/
// A flag is secret by how it ends: `--password-stdin` and `--token-file` take no credential.
const SECRET_FLAG =
  /^_(?:[a-z\d]+_)*(?:passw(?:or)?d|passphrase|pass(?:in|out)?|token|secret(?:_string)?|cookie|(?:api|access|secret|auth)_?key|credentials?)$/
// Words that change what a flag after them means.
const TOOLS: readonly (readonly [kind: string, word: RegExp])[] = [
  ['mysql', /^(?:mysql|mariadb)[\w-]*$/],
  ['password-prompt', /^(?:sshpass|login|twine)$/],
  ['redis', /^redis-cli$/],
  ['secret', /^secret$/],
  ['curl', /^curl$/],
  ['http', /^(?:curl|wget)$/],
  ['shell', /^(?:ssh|eval|watch)$/]
]
// Flags that are a credential only for a tool: tool, flag, whether a separate value counts.
const TOOL_SECRET_FLAGS: readonly (readonly [kind: string, flag: string, separate: boolean])[] = [
  ['mysql', '-p', false],
  ['password-prompt', '-p', true],
  ['redis', '-a', true],
  ['secret', '--body', true],
  ['secret', '-b', true],
  ['secret', '--value', true],
  ['curl', '-b', true]
]
// Short flags combine, as in `curl -sH`: the last letter takes the value.
const USER_FLAG = /^(?:-[A-Za-z]*[uU]|--user|--proxy-user)$/
const HEADER_FLAG = /^(?:-[A-Za-z]*H|--header)$/
const HEADER = /^([\w-]+):\s*(?:(?:Basic|Bearer|Token|Digest|Negotiate)\s+)?/i
const SHELL_STRING_FLAG = /^(?:-[A-Za-z]*c|-[Cc]ommand|\/[ckCK])$/
const MAX_NESTED_SHELLS = 2

const SQL_PASSWORD = /\b(?:password|identified\s+by)\s+(?=\\?['"])/gi
const URL_PASSWORD = /(?<![a-z\d+.-])([a-z][a-z\d+.-]*:\/\/[^\s/:@'"]*:)([^\s/'"]+)@/gi
const LABEL =
  /(?<![\w.%-])(?:(\\?["'])([A-Za-z_][\w.-]*)\1|([A-Za-z_][\w.-]*))(\s*(?::|=>|={1,3})\s*)((?:Basic|Bearer|Token|Digest)[^\S\r\n]+)?(?!~)/g
// What `redactString` would take for a credential or a `.env` line and is neither here.
const NOT_LABELS = [
  /\b[Bb]earer(?=\s+[a-z]+(?![\w.~+/=-]))/g,
  /\$\{?\w+\}?\\?["']\s*[:=]/g,
  /^[^\S\r\n\u2028\u2029]*[A-Z_][A-Z\d_]*\s*=/gm
]

const REFERENCE = /^(?:\$(?:\(.*|\{[^}]*\}|(?:env:)?\w+)?|`.*|%\w+%)$/s
const NOT_A_CREDENTIAL =
  /^(?:|true|false|yes|no|on|off|null|none|[01]|\[redacted(?::[\w-]+)?\]|https?:\/\/[^\s@?]+)$/i
// After a spaced separator: a word of prose, or a call in code.
const NOT_WRITTEN_OUT = /^[A-Z]?[a-z]+$|[()]/
const ENDS_ITS_STRING = /^$|^[\r\n"',}\]\\]/

/** `apiKey`, `API-KEY` and `api.key` as `api_key`. */
function nameParts(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z\d]+/g, '_')
    .toLowerCase()
}

function looksSecret(name: string): boolean {
  const parts = nameParts(name)
  return SECRET_NAME.test(parts) && !ABOUT_A_SECRET.test(parts)
}

/** A word as the name of a program: no folder, no `.exe`. */
function toolName(word: string): string {
  const name = word.slice(Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\')) + 1)
  return name.replace(/\.exe$/i, '').toLowerCase()
}

const isCredential = (value: string, literal: boolean): boolean =>
  !NOT_A_CREDENTIAL.test(value) && (literal || !REFERENCE.test(value))

function settle(command: string, put: Put, label: number, value: Value): void {
  // `redactString` marks a label it can see even when the value after it is already gone.
  put(label, value.start)
  if (isCredential(command.slice(value.start, value.end), value.literal)) {
    put(value.start, value.end, MARK)
  }
}

/** Where the credential starts in the value of a flag; null when the flag takes none. */
function credentialStart(
  tools: ReadonlySet<string>,
  flag: string,
  value: string,
  packed: boolean
): number | null {
  const toolSecret = TOOL_SECRET_FLAGS.some(
    ([kind, name, separate]) => flag === name && (packed || separate) && tools.has(kind)
  )
  if (toolSecret || (!packed && SECRET_FLAG.test(nameParts(flag)))) {
    return 0
  }
  if (USER_FLAG.test(flag) && tools.has('http')) {
    return value.includes(':') ? value.indexOf(':') + 1 : null
  }
  const header = HEADER_FLAG.test(flag) ? HEADER.exec(value) : null
  return header && looksSecret(header[1] ?? '') ? header[0].length : null
}

/** Credentials a shell word carries because of the flag or the tool it belongs to. */
function settleArguments(
  command: string,
  span: Span,
  put: Put,
  depth: number,
  quoting?: Uint8Array
): void {
  for (const words of shellCommands(command.slice(span.start, span.end), span.start, quoting)) {
    const tools = new Set<string>()
    const settleFlag = (flag: string, label: number, value: Value, packed: boolean): void => {
      const at = credentialStart(tools, flag, command.slice(value.start, value.end), packed)
      if (at !== null) {
        settle(command, put, label, { ...value, start: value.start + at })
      }
    }
    let previous = ''
    let config: 'none' | 'key' | 'value' = 'none'
    for (const word of words) {
      const text = command.slice(word.start, word.end)
      const value = unquoted(command, word)
      const isValue = !/^[-<>]/.test(text)
      const attached = /^(--?[A-Za-z][\w-]*)=|^-[A-Za-z](?=.)/.exec(text)
      if (attached) {
        const rest = unquoted(command, { start: word.start + attached[0].length, end: word.end })
        settleFlag(attached[1] ?? attached[0], word.start, rest, attached[1] === undefined)
      }
      if (isValue && previous.startsWith('-') && !previous.includes('=')) {
        settleFlag(previous, word.start, value, false)
      }
      if (config === 'value') {
        if (isValue) {
          settle(command, put, word.start, value)
        }
        config = 'none'
      } else if (config === 'key' && isValue && !/^(?:set|add)(?:-[a-z-]+)?$/.test(text)) {
        config = looksSecret(text.split(/[.:/]/).at(-1) ?? '') ? 'value' : 'none'
      } else if (/^config(?:ure)?$/.test(text)) {
        config = 'key'
      }
      const holdsShell = SHELL_STRING_FLAG.test(previous) || tools.has('shell')
      if (holdsShell && value.start > word.start && depth < MAX_NESTED_SHELLS) {
        settleArguments(command, value, put, depth + 1)
      }
      if (isValue) {
        const name = toolName(command.slice(value.start, value.end))
        for (const [kind, tool] of TOOLS) {
          if (tool.test(name)) {
            tools.add(kind)
          }
        }
      }
      previous = text
    }
  }
}

/** `NAME=value`, `"name": "value"` and `name: value` wherever they stand, for secret names only. */
function settleLabels(command: string, quoting: Uint8Array, put: Put): void {
  for (const match of command.matchAll(LABEL)) {
    const [whole, , quotedName, bareName, separator = '', scheme] = match
    const at = match.index + whole.length
    const bare = !/["'\\]/.test(command.charAt(at))
    // `auth:login` is a task, `secret:/run/secrets` a volume: a bare value needs more than a colon.
    const taskLike = bare && separator === ':' && scheme === undefined
    if (!looksSecret(quotedName ?? bareName ?? '') || !put(match.index, at) || taskLike) {
      continue
    }
    const value = valueAfter(command, quoting, at)
    const text = command.slice(value.start, value.end)
    // `token: add refresh` is a commit subject: after a space, the value must end its string.
    const written =
      value.quoted ||
      scheme !== undefined ||
      separator === '=' ||
      (ENDS_ITS_STRING.test(command.charAt(value.end)) && !NOT_WRITTEN_OUT.test(text))
    if (written && isCredential(text, value.literal)) {
      put(value.start, value.end, MARK)
    }
  }
}

/** `redactString` on the text between two settled spans. */
function redactGap(gap: string): string {
  const redacted = gap ? redactString(GUARD + gap) : GUARD
  if (!redacted.startsWith(GUARD)) {
    throw new Error('the prose redactor rewrote the start of a gap')
  }
  return redacted.slice(GUARD.length)
}

function redactCommand(command: string): string {
  const settled = new Uint8Array(command.length)
  const quoting = commandQuoting(command)
  const edits: Edit[] = []
  const put: Put = (start, end, replacement = command.slice(start, end)) => {
    if (end <= start || settled.subarray(start, end).includes(1)) {
      return false
    }
    settled.fill(1, start, end)
    edits.push({ start, end, replacement })
    return true
  }
  settleArguments(command, { start: 0, end: command.length }, put, 0, quoting)
  for (const match of command.matchAll(URL_PASSWORD)) {
    const start = match.index + (match[1] ?? '').length
    const end = start + (match[2] ?? '').length
    settle(command, put, match.index, { start, end, literal: false })
  }
  for (const match of command.matchAll(SQL_PASSWORD)) {
    const value = valueAfter(command, quoting, match.index + match[0].length)
    settle(command, put, value.start, value)
  }
  settleLabels(command, quoting, put)
  for (const pattern of NOT_LABELS) {
    for (const match of command.matchAll(pattern)) {
      put(match.index, match.index + match[0].length)
    }
  }
  if (edits.length === 0) {
    return redactString(command)
  }
  edits.sort((a, b) => a.start - b.start)
  let redacted = ''
  let from = 0
  for (const edit of edits) {
    redacted += redactGap(command.slice(from, edit.start)) + edit.replacement
    from = edit.end
  }
  return redacted + redactGap(command.slice(from))
}

/** A shell command line with its credentials replaced, safe to send to the judge. */
export function redactRecapCommand(command: string): string {
  try {
    return redactCommand(command)
  } catch {
    return UNREADABLE_COMMAND
  }
}
