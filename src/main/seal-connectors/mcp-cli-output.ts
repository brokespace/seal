import { stripAnsiEscapeSequences } from '../../shared/ansi-escape-sequences'
import { isSecretValue } from '../../shared/agent-config/agent-config-secrets'
import { isPlainObject } from '../../shared/agent-config/agent-config-values'
import type { McpCliServer, McpCliServerKind, McpCliServerStatus } from './mcp-cli-types'

const SECRET_FLAG = /(token|secret|password|passwd|api[-_]?key|auth|credential|bearer)/i
// Long opaque strings in a command line are usually keys.
const OPAQUE = /^[A-Za-z0-9+/=_.-]{24,}$/
const MASK = '••••'
// `--flag=value`, `Header:value` or `NAME=value`.
const NAMED_VALUE = /^(-{0,2}[A-Za-z][\w-]*)([:=])(.*)$/s
const AUTH_SCHEME = /^(bearer|basic|token)$/i
// `name: target - <status>`; the status starts with the CLI's mark (✔, !, ✘ or -).
const LIST_LINE = /^(.+?): (.*?)\s+- ([✔✓!✘✗⚠-] .*)$/u
// eslint-disable-next-line no-control-regex -- OSC 8 hyperlinks are delimited by ESC and BEL.
const OSC8_LINK = /\u001b\]8;[^;\u0007\u001b]*;(https?:\/\/[^\u0007\u001b]+)(?:\u0007|\u001b\\)/
// Only once whitespace ends it: output arrives in chunks, so a URL at the very end may be cut.
const WEB_URL = /https?:\/\/\S+(?=\s)/

export function cleanCliOutput(text: string): string {
  return stripAnsiEscapeSequences(text).replaceAll('\r', '')
}

/** Drops credentials, query strings and fragments, which can carry keys or codes. */
export function sanitizeConnectorUrl(raw: string): string {
  try {
    const url = new URL(raw)
    return `${url.protocol}//${url.host}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return raw.replace(/[?#].*$/, '')
  }
}

export function sanitizeConnectorCommand(words: readonly string[]): string {
  // Set after a secret's name (`--token`, `Authorization:`) or an auth scheme, for the word next.
  let hideNext = false
  return words
    .map((word) => {
      const hide = hideNext
      hideNext = false
      const named = NAMED_VALUE.exec(word)
      if (named && named[3] !== '') {
        const [, name, separator, value] = named
        if (isSecretValue(name, value)) {
          hideNext = AUTH_SCHEME.test(value)
          return `${name}${separator}${MASK}`
        }
      }
      if (hide) {
        hideNext = AUTH_SCHEME.test(word)
        return MASK
      }
      if (AUTH_SCHEME.test(word)) {
        hideNext = true
        return word
      }
      if (SECRET_FLAG.test(word) && (word.startsWith('-') || named?.[3] === '')) {
        hideNext = true
        return word
      }
      return OPAQUE.test(word) && !word.includes('/') ? MASK : word
    })
    .join(' ')
}

export function connectorKindOf(name: string, userServers: ReadonlySet<string>): McpCliServerKind {
  if (name.startsWith('claude.ai ')) {
    return 'claude-ai'
  }
  if (name.startsWith('plugin:')) {
    return 'plugin'
  }
  return userServers.has(name) ? 'user' : 'project'
}

function claudeStatus(text: string): { status: McpCliServerStatus; detail: string | null } {
  const words = text.replace(/^[✔✓!✘✗⚠-]\s*/u, '').trim()
  if (/^[✔✓]/u.test(text)) {
    return { status: 'connected', detail: null }
  }
  if (/needs authentication/i.test(words)) {
    return { status: 'needs-auth', detail: null }
  }
  if (/disabled/i.test(words)) {
    return { status: 'disabled', detail: null }
  }
  return { status: 'failed', detail: words || null }
}

function claudeTarget(summary: string): Pick<McpCliServer, 'transport' | 'target'> {
  const remote = /^(\S+) \((HTTP|SSE)\)$/i.exec(summary.trim())
  if (remote) {
    return {
      transport: remote[2].toLowerCase() === 'sse' ? 'sse' : 'http',
      target: sanitizeConnectorUrl(remote[1])
    }
  }
  const words = summary.trim().split(/\s+/).filter(Boolean)
  if (words.length === 1 && /^https?:\/\//i.test(words[0])) {
    return { transport: 'http', target: sanitizeConnectorUrl(words[0]) }
  }
  return { transport: words.length > 0 ? 'stdio' : null, target: sanitizeConnectorCommand(words) }
}

/** Parses `claude mcp list`; lines that are not a server (progress, SDK warnings) are skipped. */
export function parseClaudeMcpList(
  output: string,
  userServers: ReadonlySet<string>
): McpCliServer[] {
  const connectors: McpCliServer[] = []
  for (const line of cleanCliOutput(output).split('\n')) {
    const match = LIST_LINE.exec(line.trim())
    if (!match || match[1].startsWith('[')) {
      continue
    }
    const name = match[1].trim()
    connectors.push({
      name,
      kind: connectorKindOf(name, userServers),
      ...claudeTarget(match[2]),
      ...claudeStatus(match[3])
    })
  }
  return connectors
}

function codexEntry(entry: unknown): McpCliServer | null {
  if (!isPlainObject(entry) || typeof entry.name !== 'string') {
    return null
  }
  const transport = isPlainObject(entry.transport) ? entry.transport : {}
  const url = typeof transport.url === 'string' ? transport.url : null
  const command = typeof transport.command === 'string' ? transport.command : null
  const args = Array.isArray(transport.args)
    ? transport.args.filter((arg): arg is string => typeof arg === 'string')
    : []
  const auth = typeof entry.auth_status === 'string' ? entry.auth_status : ''
  const status: McpCliServerStatus =
    entry.enabled === false
      ? 'disabled'
      : auth === 'not_logged_in'
        ? 'needs-auth'
        : auth === 'o_auth' || auth === 'bearer_token'
          ? 'connected'
          : 'configured'
  return {
    name: entry.name,
    kind: 'user',
    transport: url ? 'http' : command ? 'stdio' : null,
    target: url
      ? sanitizeConnectorUrl(url)
      : command
        ? sanitizeConnectorCommand([command, ...args])
        : '',
    status,
    detail:
      entry.enabled === false && typeof entry.disabled_reason === 'string'
        ? entry.disabled_reason
        : null
  }
}

/** Parses `codex mcp list --json`. Codex does not health-check, so only sign-in state is known. */
export function parseCodexMcpList(output: string): McpCliServer[] {
  const text = cleanCliOutput(output)
  const start = text.indexOf('[')
  if (start === -1) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(text.slice(start))
    return Array.isArray(parsed)
      ? parsed.map(codexEntry).filter((entry): entry is McpCliServer => entry !== null)
      : []
  } catch {
    return []
  }
}

/** The authorize URL `mcp login --no-browser` prints; the OSC 8 link target survives line wraps. */
export function findAuthorizeUrl(raw: string): string | null {
  const linked = OSC8_LINK.exec(raw)?.[1]
  const text = cleanCliOutput(raw)
  // From the first "authoriz", so one inside the URL's own path does not cut it.
  const afterPrompt = text.slice(Math.max(0, text.search(/authoriz/i)))
  const candidate = linked ?? WEB_URL.exec(afterPrompt)?.[0] ?? WEB_URL.exec(text)?.[0]
  if (!candidate) {
    return null
  }
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

/** The CLI's last words, with links (which carry codes and state) left out. */
export function lastCliMessage(raw: string): string | null {
  const lines = cleanCliOutput(raw)
    .split('\n')
    .map((line) => line.replace(/https?:\/\/[^\s"'<>]+/g, '<link>').trim())
    .filter((line) => line && !/^Or paste the redirect URL/i.test(line))
  return lines.at(-1) ?? null
}
