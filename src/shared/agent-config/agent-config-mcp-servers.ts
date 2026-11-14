import type { AgentConfigMcpCodec } from './agent-config-catalog'
import {
  mcpCodec,
  mcpEntryIssue,
  validateMcpDraft,
  type McpEntryFields
} from './agent-config-mcp-codec'
import {
  maskArgs,
  maskRecord,
  maskUrl,
  restoreArgs,
  restoreRecord,
  restoreUrl
} from './agent-config-secrets'
import type {
  AgentConfigMcpDraft,
  AgentConfigMcpServer,
  AgentConfigScope
} from './agent-config-types'
import { deepEqual, isPlainObject, valueAtPath } from './agent-config-values'

/** Where one agent keeps one scope's servers. */
export type McpServersLocation = {
  scope: AgentConfigScope
  /** Absolute path of the file. */
  sourcePath: string
  codec: AgentConfigMcpCodec
  /** Keys leading to the servers map inside the file. */
  serversPath: string[]
}

export type McpEdit = { path: string[]; value: unknown } | { path: string[]; remove: true }

function serversOf(config: unknown, location: McpServersLocation): Record<string, unknown> {
  const servers = valueAtPath(config, location.serversPath)
  return isPlainObject(servers) ? servers : {}
}

export function rawMcpEntry(
  config: unknown,
  location: McpServersLocation,
  name: string
): Record<string, unknown> | undefined {
  const servers = serversOf(config, location)
  const entry = Object.hasOwn(servers, name) ? servers[name] : undefined
  return isPlainObject(entry) ? entry : undefined
}

function describe(
  name: string,
  fields: McpEntryFields,
  entry: Record<string, unknown>,
  location: McpServersLocation,
  masked: boolean
): AgentConfigMcpServer {
  const codec = mcpCodec(location.codec)
  const env = masked ? maskRecord(fields.env, 'env') : { value: fields.env, masked: [] }
  const headers = masked
    ? maskRecord(fields.headers, 'headers')
    : { value: fields.headers, masked: [] }
  const args = masked ? maskArgs(fields.args) : { value: fields.args, masked: [] }
  const url = masked ? maskUrl(fields.url) : fields.url
  return {
    name,
    scope: location.scope,
    sourcePath: location.sourcePath,
    transport: fields.transport,
    command: fields.command,
    args: args.value,
    env: env.value,
    url,
    headers: headers.value,
    maskedFields: [
      ...env.masked,
      ...headers.masked,
      ...args.masked,
      ...(url === fields.url ? [] : ['url'])
    ],
    enabled: fields.enabled,
    extraKeys: Object.keys(entry).filter((key) => !codec.knownKeys.includes(key)),
    issue: mcpEntryIssue(fields)
  }
}

/** The servers in one parsed file. Secrets are masked unless the user asked to see them. */
export function listMcpServers(
  config: unknown,
  location: McpServersLocation,
  options: { reveal?: boolean } = {}
): AgentConfigMcpServer[] {
  const codec = mcpCodec(location.codec)
  return Object.entries(serversOf(config, location)).map(([name, entry]) => {
    if (!isPlainObject(entry)) {
      return {
        ...describe(name, codec.read({}), {}, location, true),
        issue: 'The entry is not a table of settings'
      }
    }
    return describe(name, codec.read(entry), entry, location, !options.reveal)
  })
}

/** Marks servers that a same-named server in a stronger scope replaces: local, project, user. */
export function markShadowedServers(servers: AgentConfigMcpServer[]): AgentConfigMcpServer[] {
  const rank: Record<AgentConfigScope, number> = { user: 0, project: 1, local: 2 }
  return servers.map((server) => {
    const winner = servers
      .filter((other) => other.name === server.name && rank[other.scope] > rank[server.scope])
      .toSorted((a, b) => rank[b.scope] - rank[a.scope])[0]
    return winner ? { ...server, shadowedBy: winner.scope } : server
  })
}

/**
 * The edits that make the file say what the form says. Only keys the form owns are touched, so
 * settings Seal has no field for (timeouts, tool filters, OAuth blocks) survive every save.
 */
export function mcpSaveEdits(
  config: unknown,
  location: McpServersLocation,
  draft: AgentConfigMcpDraft,
  originalName: string | undefined
): McpEdit[] {
  const codec = mcpCodec(location.codec)
  const name = draft.name.trim()
  const problems = validateMcpDraft({ ...draft, name }, codec)
  if (problems.length > 0) {
    throw new Error(problems.join('. '))
  }
  const servers = serversOf(config, location)
  const renamed = originalName !== undefined && originalName !== name
  if ((originalName === undefined || renamed) && Object.hasOwn(servers, name)) {
    throw new Error(`There is already a server named "${name}" in ${location.sourcePath}`)
  }
  const existing =
    originalName === undefined ? undefined : rawMcpEntry(config, location, originalName)
  if (originalName !== undefined && !existing) {
    throw new Error(
      `"${originalName}" is no longer in ${location.sourcePath}; reload and try again`
    )
  }
  const stored = codec.read(existing ?? {})
  const patch = codec.write(
    {
      transport: draft.transport,
      command: draft.command.trim(),
      args: restoreArgs(draft.args, stored.args),
      env: restoreRecord(draft.env, stored.env, 'variable'),
      url: restoreUrl(draft.url.trim(), stored.url),
      headers: restoreRecord(draft.headers, stored.headers, 'header'),
      enabled: draft.enabled
    },
    existing ?? {}
  )
  const entryPath = [...location.serversPath, name]
  if (!existing || renamed) {
    const entry: Record<string, unknown> = { ...existing, ...patch.set }
    for (const key of patch.remove) {
      delete entry[key]
    }
    return [
      ...(renamed
        ? [{ path: [...location.serversPath, originalName], remove: true as const }]
        : []),
      { path: entryPath, value: entry }
    ]
  }
  return [
    ...Object.entries(patch.set)
      .filter(([key, value]) => !deepEqual(existing[key], value))
      .map(([key, value]) => ({ path: [...entryPath, key], value })),
    ...patch.remove
      .filter((key) => Object.hasOwn(existing, key))
      .map((key) => ({ path: [...entryPath, key], remove: true as const }))
  ]
}

/** A server as another agent's file would spell it, for copying between agents and machines. */
export function convertMcpEntry(
  entry: Record<string, unknown>,
  from: AgentConfigMcpCodec,
  to: AgentConfigMcpCodec
): Record<string, unknown> {
  if (from === to) {
    return entry
  }
  const fields = mcpCodec(from).read(entry)
  const target = mcpCodec(to)
  if (!target.transports.includes(fields.transport)) {
    if (fields.transport !== 'sse') {
      throw new Error(`The target agent has no ${fields.transport.toUpperCase()} servers`)
    }
    fields.transport = 'http'
  }
  return target.write(fields, {}).set
}
