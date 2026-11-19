import { parseJsonObject } from '../../shared/agent-config/agent-config-json-edit'
import { isPlainObject, stringList } from '../../shared/agent-config/agent-config-values'
import type { AgentPluginProvides } from '../../shared/agent-plugins/agent-plugin-types'
import { joinMachinePath } from '../../shared/machines/machine-paths'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { joinRelative } from '../agent-config/agent-config-locations'

const MAX_JSON_BYTES = 1024 * 1024
/** Each agent's manifest folder; a plugin written for one is often read by the other. */
const MANIFEST_DIRS = ['.claude-plugin', '.codex-plugin', '.cursor-plugin']
const SKILL_FILE = 'SKILL.md'

export type AgentPluginFolder = {
  name: string | null
  description: string
  version: string | null
  provides: AgentPluginProvides
}

function relativePaths(value: unknown): string[] {
  return (typeof value === 'string' ? [value] : stringList(value))
    .map((path) => path.replaceAll('\\', '/').replace(/^(\.\/)+/, ''))
    .filter((path) => path !== '' && !path.split('/').includes('..') && !path.startsWith('/'))
}

async function readJson(
  connection: MachineConnection,
  path: string
): Promise<Record<string, unknown> | null> {
  const read = await connection.files.readFile(path, MAX_JSON_BYTES).catch(() => null)
  const parsed = read ? parseJsonObject(read.data.toString('utf8')) : null
  return parsed?.ok ? parsed.value : null
}

async function names(
  connection: MachineConnection,
  dir: string,
  pick: (entry: { name: string; isDirectoryLike: boolean }) => string | null
): Promise<string[]> {
  const entries = await connection.files.listDir(dir).catch(() => [])
  return entries.flatMap((entry) => pick(entry) ?? []).toSorted()
}

/** `.mcp.json` holds either `{ mcpServers: {…} }` or the servers map itself. */
function serversIn(value: Record<string, unknown> | null): Record<string, Record<string, unknown>> {
  const map = value && isPlainObject(value.mcpServers) ? value.mcpServers : (value ?? {})
  return Object.fromEntries(
    Object.entries(map).filter((entry): entry is [string, Record<string, unknown>] =>
      isPlainObject(entry[1])
    )
  )
}

async function mcpServers(
  connection: MachineConnection,
  root: string,
  declared: unknown
): Promise<Record<string, Record<string, unknown>>> {
  if (isPlainObject(declared)) {
    return serversIn(declared)
  }
  const files = relativePaths(declared)
  const read = await Promise.all(
    (files.length > 0 ? files : ['.mcp.json']).map((file) =>
      readJson(connection, joinRelative(root, file))
    )
  )
  return Object.assign({}, ...read.map(serversIn))
}

async function skills(
  connection: MachineConnection,
  root: string,
  declared: unknown
): Promise<AgentPluginProvides['skills']> {
  const dirs = [...new Set([...relativePaths(declared), 'skills'])]
  const found = await Promise.all(
    dirs.map(async (relative) => {
      const dir = joinRelative(root, relative)
      const entries = await connection.files.listDir(dir).catch(() => [])
      // A declared folder can be one skill itself.
      if (entries.some((entry) => entry.name === SKILL_FILE)) {
        return [
          {
            name: relative.split('/').findLast((part) => part.length > 0) ?? relative,
            directory: dir
          }
        ]
      }
      const candidates = await Promise.all(
        entries
          .filter((entry) => entry.isDirectoryLike && !entry.name.startsWith('.'))
          .map(async (entry) => {
            const directory = joinMachinePath(dir, entry.name)
            const stat = await connection.files
              .stat(joinMachinePath(directory, SKILL_FILE))
              .catch(() => null)
            return stat ? [{ name: entry.name, directory }] : []
          })
      )
      return candidates.flat()
    })
  )
  const seen = new Set<string>()
  return found.flat().filter((skill) => !seen.has(skill.name) && Boolean(seen.add(skill.name)))
}

async function hookEvents(
  connection: MachineConnection,
  root: string,
  declared: unknown
): Promise<string[]> {
  const files = relativePaths(declared)
  const read = isPlainObject(declared)
    ? [declared]
    : await Promise.all(
        (files.length > 0 ? files : ['hooks/hooks.json']).map((file) =>
          readJson(connection, joinRelative(root, file))
        )
      )
  return [
    ...new Set(
      read.flatMap((value) =>
        value ? Object.keys(isPlainObject(value.hooks) ? value.hooks : value) : []
      )
    )
  ]
}

/** What a plugin's folder brings, read from its manifest and the folders plugins use by convention. */
export async function readAgentPluginFolder(
  connection: MachineConnection,
  root: string
): Promise<AgentPluginFolder> {
  let manifest: Record<string, unknown> = {}
  for (const dir of MANIFEST_DIRS) {
    const found = await readJson(connection, joinRelative(root, `${dir}/plugin.json`))
    if (found) {
      manifest = found
      break
    }
  }
  const stem = (entry: { name: string }, extensions: RegExp): string | null =>
    extensions.test(entry.name) ? entry.name.replace(extensions, '') : null
  const [servers, skillList, commands, agents, hooks, lsp, apps] = await Promise.all([
    mcpServers(connection, root, manifest.mcpServers),
    skills(connection, root, manifest.skills),
    names(connection, joinRelative(root, 'commands'), (entry) => stem(entry, /\.(md|toml)$/)),
    names(connection, joinRelative(root, 'agents'), (entry) => stem(entry, /\.(md|toml)$/)),
    hookEvents(connection, root, manifest.hooks),
    isPlainObject(manifest.lspServers)
      ? Promise.resolve(manifest.lspServers)
      : readJson(connection, joinRelative(root, '.lsp.json')),
    readJson(connection, joinRelative(root, '.app.json'))
  ])
  return {
    name: typeof manifest.name === 'string' ? manifest.name : null,
    description: typeof manifest.description === 'string' ? manifest.description : '',
    version: typeof manifest.version === 'string' ? manifest.version : null,
    provides: {
      mcpServers: servers,
      skills: skillList,
      commands,
      agents,
      hooks,
      lspServers: Object.keys(lsp ?? {}),
      apps: Object.keys(apps && isPlainObject(apps.apps) ? apps.apps : {})
    }
  }
}
