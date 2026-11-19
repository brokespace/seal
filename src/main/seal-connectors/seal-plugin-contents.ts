import { createHash } from 'node:crypto'
import { readFrontmatter } from '../../shared/agent-config/agent-config-frontmatter'
import { isPlainObject } from '../../shared/agent-config/agent-config-values'
import { joinMachinePath } from '../../shared/machines/machine-paths'
import {
  SERVER_NAME_PATTERN,
  type Connector,
  type ConnectorTransport,
  type PluginEntry,
  type SealConnectorsConfig,
  type SkillEntry
} from '../../shared/seal-connectors/seal-connectors-types'
import { readAgentPluginFolder } from '../agent-plugins/agent-plugin-folder-read'
import type { MachineConnection } from '../machines/connection/machine-connection'
import type { SealPluginLibrary } from './seal-connectors-host'

const MAX_SKILL_MARKDOWN_BYTES = 256 * 1024

/** Same on every machine, so two machines installing one plugin converge on one item. */
function pluginItemId(prefix: string, pluginId: string, itemKey: string): string {
  return `${prefix}${createHash('sha256').update(`${pluginId}\n${itemKey}`).digest('hex').slice(0, 20)}`
}

function titleCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** A server key as an MCP name sessions can use, unique among `taken`. */
function connectorName(key: string, taken: Set<string>): string {
  const base =
    key
      .toLowerCase()
      .replaceAll(/[^a-z0-9_-]+/g, '-')
      .replace(/^[^a-z0-9]+/, '')
      .slice(0, 60) || 'server'
  let name = base
  for (let n = 2; taken.has(name) || !SERVER_NAME_PATTERN.test(name); n += 1) {
    name = `${base}-${n}`
  }
  taken.add(name)
  return name
}

function stringRecord(value: unknown): Record<string, string> {
  return isPlainObject(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      )
    : {}
}

/** A plugin's `.mcp.json` entry as a connector transport and how it signs in; null when unusable. */
function readPluginServer(
  server: Record<string, unknown>
): { transport: ConnectorTransport; auth: Connector['auth'] } | null {
  if (typeof server.url === 'string' && server.url !== '') {
    const oauthValue = isPlainObject(server.oauth) ? server.oauth : null
    const clientId = typeof oauthValue?.clientId === 'string' ? oauthValue.clientId : undefined
    const callbackPort =
      typeof oauthValue?.callbackPort === 'number' ? oauthValue.callbackPort : undefined
    const hasHeaders = Object.keys(stringRecord(server.headers)).length > 0
    return {
      transport: {
        type: 'http',
        url: server.url,
        ...(clientId !== undefined || callbackPort !== undefined
          ? {
              oauth: {
                ...(clientId !== undefined ? { clientId } : {}),
                ...(callbackPort !== undefined ? { callbackPort } : {})
              }
            }
          : {})
      },
      // A web server that names no headers is an OAuth one (Slack, Atlassian...).
      auth: oauthValue || !hasHeaders ? 'oauth' : 'static'
    }
  }
  if (typeof server.command === 'string' && server.command.trim() !== '') {
    return {
      transport: {
        type: 'stdio',
        command: server.command,
        args: Array.isArray(server.args)
          ? server.args.filter((arg): arg is string => typeof arg === 'string')
          : [],
        env: stringRecord(server.env)
      },
      auth: 'none'
    }
  }
  return null
}

async function skillDescription(connection: MachineConnection, directory: string): Promise<string> {
  const read = await connection.files
    .readFile(joinMachinePath(directory, 'SKILL.md'), MAX_SKILL_MARKDOWN_BYTES)
    .catch(() => null)
  const description = read ? readFrontmatter(read.data.toString('utf8')).data.description : null
  return typeof description === 'string' ? description.trim().slice(0, 2000) : ''
}

/** What a fetched plugin brings: its MCP servers as connectors and its skills, scoped like the plugin. */
export async function readPluginParts(
  connection: MachineConnection,
  library: SealPluginLibrary,
  entry: PluginEntry,
  config: SealConnectorsConfig
): Promise<{
  connectors: Connector[]
  skills: SkillEntry[]
  version: string | null
  description: string
}> {
  const dir = library.pluginDir(entry.id)
  if (!dir) {
    throw new Error(
      library.state().find((item) => item.id === entry.id)?.error ?? 'The plugin was not fetched'
    )
  }
  const folder = await readAgentPluginFolder(connection, dir)
  const apps = folder.provides.apps.length
  const servers = Object.entries(folder.provides.mcpServers)
  if (entry.harness === 'codex' && apps > 0 && servers.length === 0) {
    throw new Error(`${entry.name} is a ChatGPT app, which only runs inside ChatGPT`)
  }
  const taken = new Set(config.connectors.map((connector) => connector.name))
  const scoped = {
    enabled: true,
    appliesTo: entry.appliesTo,
    projectOverrides: entry.projectOverrides
  }
  const connectors = servers.flatMap(([key, server]): Connector[] => {
    const read = readPluginServer(server)
    if (!read) {
      return []
    }
    return [
      {
        ...scoped,
        id: pluginItemId('conn_', entry.id, key),
        name: connectorName(key, taken),
        title: (servers.length === 1
          ? titleCase(entry.name)
          : `${titleCase(entry.name)} ${key}`
        ).slice(0, 120),
        transport: read.transport,
        source: { kind: 'plugin', pluginId: entry.id },
        auth: read.auth,
        signIns: [],
        disabledTools: []
      }
    ]
  })
  const skills = await Promise.all(
    folder.provides.skills.map(async (skill): Promise<SkillEntry> => ({
      ...scoped,
      id: pluginItemId('skill_', entry.id, skill.name),
      name: skill.name,
      description: await skillDescription(connection, skill.directory),
      source: { kind: 'plugin', pluginId: entry.id }
    }))
  )
  return { connectors, skills, version: folder.version, description: folder.description }
}
