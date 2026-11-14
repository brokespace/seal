import type { AgentConfigMcpCodec } from './agent-config-catalog'
import type { AgentConfigMcpDraft, AgentConfigMcpTransport } from './agent-config-types'
import { isPlainObject, stringList, stringRecord } from './agent-config-values'

/** A server entry as the form sees it, whichever agent's file it came from. */
export type McpEntryFields = {
  transport: AgentConfigMcpTransport
  command: string
  args: string[]
  env: Record<string, string>
  url: string
  headers: Record<string, string>
  enabled: boolean
}

export type McpEntryPatch = { set: Record<string, unknown>; remove: string[] }

export type McpCodec = {
  transports: readonly AgentConfigMcpTransport[]
  /** The entry itself can be switched off without deleting it. */
  canDisable: boolean
  /** Keys the form owns; everything else in an entry is kept as written. */
  knownKeys: readonly string[]
  read(entry: Record<string, unknown>): McpEntryFields
  /** The keys to write and to drop so the entry says what the form says. */
  write(fields: McpEntryFields, existing: Record<string, unknown>): McpEntryPatch
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function patch(desired: Record<string, unknown>, owned: readonly string[]): McpEntryPatch {
  const set: Record<string, unknown> = {}
  const remove: string[] = []
  for (const key of owned) {
    const value = desired[key]
    const empty =
      value === undefined ||
      value === '' ||
      (Array.isArray(value) && value.length === 0) ||
      (isPlainObject(value) && Object.keys(value).length === 0)
    if (empty) {
      remove.push(key)
    } else {
      set[key] = value
    }
  }
  return { set, remove }
}

const STANDARD_KEYS = ['type', 'command', 'args', 'env', 'url', 'headers', 'disabled']

function standardCodec(canDisable: boolean): McpCodec {
  return {
    transports: ['stdio', 'http', 'sse'],
    canDisable,
    knownKeys: STANDARD_KEYS,
    read(entry) {
      const url = text(entry.url)
      const transport =
        entry.type === 'sse' ? 'sse' : entry.type === 'http' || url ? 'http' : 'stdio'
      return {
        transport,
        command: text(entry.command),
        args: stringList(entry.args),
        env: stringRecord(entry.env),
        url,
        headers: stringRecord(entry.headers),
        enabled: entry.disabled !== true
      }
    },
    write(fields, existing) {
      const remote = fields.transport !== 'stdio'
      return patch(
        {
          // Claude writes no type for stdio servers; one that is already there stays correct.
          type: remote || existing.type !== undefined ? fields.transport : undefined,
          command: remote ? undefined : fields.command,
          args: remote ? undefined : fields.args,
          env: remote ? undefined : fields.env,
          url: remote ? fields.url : undefined,
          headers: remote ? fields.headers : undefined,
          disabled: canDisable && !fields.enabled ? true : undefined
        },
        STANDARD_KEYS
      )
    }
  }
}

const CODEX_KEYS = ['command', 'args', 'env', 'url', 'http_headers', 'enabled']

const codexCodec: McpCodec = {
  transports: ['stdio', 'http'],
  canDisable: true,
  knownKeys: CODEX_KEYS,
  read(entry) {
    const url = text(entry.url)
    return {
      transport: url ? 'http' : 'stdio',
      command: text(entry.command),
      args: stringList(entry.args),
      env: stringRecord(entry.env),
      url,
      headers: stringRecord(entry.http_headers),
      enabled: entry.enabled !== false
    }
  },
  write(fields) {
    const remote = fields.transport !== 'stdio'
    return patch(
      {
        command: remote ? undefined : fields.command,
        args: remote ? undefined : fields.args,
        env: remote ? undefined : fields.env,
        url: remote ? fields.url : undefined,
        http_headers: remote ? fields.headers : undefined,
        enabled: fields.enabled ? undefined : false
      },
      CODEX_KEYS
    )
  }
}

const GEMINI_KEYS = ['type', 'command', 'args', 'env', 'url', 'httpUrl', 'headers']

const geminiCodec: McpCodec = {
  transports: ['stdio', 'http', 'sse'],
  canDisable: false,
  knownKeys: GEMINI_KEYS,
  read(entry) {
    const httpUrl = text(entry.httpUrl)
    const url = text(entry.url)
    return {
      transport: httpUrl || (url && entry.type === 'http') ? 'http' : url ? 'sse' : 'stdio',
      command: text(entry.command),
      args: stringList(entry.args),
      env: stringRecord(entry.env),
      url: httpUrl || url,
      headers: stringRecord(entry.headers),
      enabled: true
    }
  },
  write(fields, existing) {
    const remote = fields.transport !== 'stdio'
    // Newer Gemini spells both remote kinds as `url` + `type`; older ones use `httpUrl` for HTTP.
    const typed = existing.type !== undefined
    const http = fields.transport === 'http'
    return patch(
      {
        type: typed ? fields.transport : undefined,
        command: remote ? undefined : fields.command,
        args: remote ? undefined : fields.args,
        env: remote ? undefined : fields.env,
        httpUrl: http && !typed ? fields.url : undefined,
        url: remote && (typed || !http) ? fields.url : undefined,
        headers: remote ? fields.headers : undefined
      },
      GEMINI_KEYS
    )
  }
}

const OPENCODE_KEYS = ['type', 'command', 'environment', 'url', 'headers', 'enabled']

const opencodeCodec: McpCodec = {
  transports: ['stdio', 'http'],
  canDisable: true,
  knownKeys: OPENCODE_KEYS,
  read(entry) {
    const command = stringList(entry.command)
    const url = text(entry.url)
    return {
      transport: entry.type === 'remote' || url ? 'http' : 'stdio',
      command: command[0] ?? '',
      args: command.slice(1),
      env: stringRecord(entry.environment),
      url,
      headers: stringRecord(entry.headers),
      enabled: entry.enabled !== false
    }
  },
  write(fields) {
    const remote = fields.transport !== 'stdio'
    return patch(
      {
        type: remote ? 'remote' : 'local',
        command: remote ? undefined : [fields.command, ...fields.args],
        environment: remote ? undefined : fields.env,
        url: remote ? fields.url : undefined,
        headers: remote ? fields.headers : undefined,
        enabled: fields.enabled ? undefined : false
      },
      OPENCODE_KEYS
    )
  }
}

const CODECS: Record<AgentConfigMcpCodec, McpCodec> = {
  claude: standardCodec(false),
  generic: standardCodec(true),
  codex: codexCodec,
  gemini: geminiCodec,
  opencode: opencodeCodec
}

export function mcpCodec(codec: AgentConfigMcpCodec): McpCodec {
  return CODECS[codec]
}

const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

/** What is wrong with a server as entered; empty when it can be written. */
export function validateMcpDraft(draft: AgentConfigMcpDraft, codec: McpCodec): string[] {
  const problems: string[] = []
  if (!SERVER_NAME.test(draft.name)) {
    problems.push('Name the server with letters, digits, dots, dashes or underscores (64 at most)')
  }
  if (!codec.transports.includes(draft.transport)) {
    problems.push(`This agent has no ${draft.transport.toUpperCase()} servers`)
  }
  if (draft.transport === 'stdio') {
    if (draft.command.trim() === '') {
      problems.push('Enter the command that starts the server')
    }
  } else {
    let protocol = ''
    try {
      protocol = new URL(draft.url).protocol
    } catch {
      // Reported below.
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
      problems.push('Enter the server URL, starting with http:// or https://')
    }
  }
  for (const [label, record] of [
    ['Variable', draft.env],
    ['Header', draft.headers]
  ] as const) {
    for (const key of Object.keys(record)) {
      if (key.trim() === '' || /[\s=]/.test(key)) {
        problems.push(`${label} names cannot be empty or contain spaces: "${key}"`)
      }
    }
  }
  return problems
}

/** What an entry is missing to be usable, for servers already in a file. */
export function mcpEntryIssue(fields: McpEntryFields): string | undefined {
  if (fields.transport === 'stdio') {
    return fields.command ? undefined : 'No command'
  }
  return fields.url ? undefined : 'No URL'
}
