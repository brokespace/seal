import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { mcpCodec, type McpEntryFields } from '../../shared/agent-config/agent-config-mcp-codec'
import type { Connector } from '../../shared/seal-connectors/seal-connectors-types'
import { claudeStateFileAsync } from '../claude-accounts/sign-in/claude-account-folder'

// Names that read as credentials stay out of the shared list and become a static sign-in.
export const SECRET_NAME =
  /token|secret|password|passwd|credential|bearer|auth|api[_-]?key|private|(^|_)key$/i

export type HostServerPaths = {
  userHome: string
  userConfigDir: () => string | undefined
  codexHome?: string
}

type Harness = 'claude' | 'codex'

export type FoundServer = {
  name: string
  harness: Harness
  fields: McpEntryFields
  oauth: { clientId?: string; callbackPort?: number } | null
  /** Set for a server Claude Code keeps for one project (local scope). */
  projectPath?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function oauthOf(entry: Record<string, unknown>): FoundServer['oauth'] {
  if (!isRecord(entry.oauth)) {
    return null
  }
  const { clientId, callbackPort } = entry.oauth
  return {
    ...(typeof clientId === 'string' ? { clientId } : {}),
    ...(typeof callbackPort === 'number' ? { callbackPort } : {})
  }
}

function serversOf(
  table: unknown,
  harness: Harness,
  read: (entry: Record<string, unknown>) => McpEntryFields
): FoundServer[] {
  if (!isRecord(table)) {
    return []
  }
  return Object.entries(table).flatMap(([name, entry]) =>
    isRecord(entry) ? [{ name, harness, fields: read(entry), oauth: oauthOf(entry) }] : []
  )
}

async function readText(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null)
}

/** The user-level MCP servers this host's Claude Code and Codex are set up with. */
export async function findHostServers(deps: HostServerPaths): Promise<FoundServer[]> {
  const claudeText = await readText(await claudeStateFileAsync(deps.userConfigDir(), deps.userHome))
  const codexText = await readText(
    join(deps.codexHome ?? process.env.CODEX_HOME ?? join(deps.userHome, '.codex'), 'config.toml')
  )
  const found: FoundServer[] = []
  try {
    const claude: unknown = claudeText ? JSON.parse(claudeText) : null
    found.push(
      ...serversOf(isRecord(claude) ? claude.mcpServers : null, 'claude', mcpCodec('claude').read)
    )
    const projects = isRecord(claude) && isRecord(claude.projects) ? claude.projects : {}
    for (const [projectPath, project] of Object.entries(projects)) {
      if (isRecord(project)) {
        found.push(
          ...serversOf(project.mcpServers, 'claude', mcpCodec('claude').read).map((server) => ({
            ...server,
            projectPath
          }))
        )
      }
    }
  } catch {
    console.warn('[seal-connectors] Could not read Claude Code’s MCP servers.')
  }
  try {
    const codex = codexText ? parseToml(codexText) : null
    found.push(...serversOf(codex?.mcp_servers, 'codex', mcpCodec('codex').read))
  } catch {
    console.warn('[seal-connectors] Could not read Codex’s MCP servers.')
  }
  return found.filter(
    (server) => !server.name.startsWith('claude.ai') && server.fields.transport !== 'sse'
  )
}

export function normalizedUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

export function transportKey(fields: McpEntryFields): string {
  return fields.transport === 'stdio'
    ? `stdio\0${fields.command}\0${fields.args.join('\0')}`
    : `http\0${normalizedUrl(fields.url)}`
}

export function connectorKey(connector: Connector): string {
  return connector.transport.type === 'stdio'
    ? `stdio\0${connector.transport.command}\0${connector.transport.args.join('\0')}`
    : `http\0${normalizedUrl(connector.transport.url)}`
}

/** Claude names plugin servers `plugin:<plugin>:<server>`; sessions see just the server. */
export function reduceServerName(raw: string): string {
  return raw.startsWith('plugin:') ? (raw.split(':').pop() ?? raw) : raw
}

export function serverName(raw: string): string {
  const cleaned = reduceServerName(raw)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 60)
  return cleaned || 'server'
}

export function titleOf(raw: string): string {
  const reduced = reduceServerName(raw)
  return (reduced.charAt(0).toUpperCase() + reduced.slice(1)).slice(0, 120) || 'Server'
}

export function uniqueName(base: string, taken: ReadonlySet<string>, suffix: string): string {
  const candidates = [base, `${base}-${suffix}`.slice(0, 64)]
  for (const name of candidates) {
    if (!taken.has(name)) {
      return name
    }
  }
  for (let n = 2; ; n += 1) {
    const name = `${base.slice(0, 60)}-${n}`
    if (!taken.has(name)) {
      return name
    }
  }
}
