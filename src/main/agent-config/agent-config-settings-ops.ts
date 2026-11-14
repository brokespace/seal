import { editJsonText, parseJsonObject } from '../../shared/agent-config/agent-config-json-edit'
import {
  convertMcpEntry,
  listMcpServers,
  mcpSaveEdits,
  rawMcpEntry,
  type McpEdit
} from '../../shared/agent-config/agent-config-mcp-servers'
import { hasMask } from '../../shared/agent-config/agent-config-secrets'
import { editTomlText, parseTomlObject } from '../../shared/agent-config/agent-config-toml-edit'
import type {
  AgentConfigMcpActivation,
  AgentConfigMcpDraft,
  AgentConfigMcpServer,
  AgentConfigScope,
  AgentConfigSettingsEdit,
  AgentConfigTarget,
  AgentConfigTomlEdit,
  AgentConfigWriteResult
} from '../../shared/agent-config/agent-config-types'
import { stringList } from '../../shared/agent-config/agent-config-values'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { readConfigFile, writeConfigFile } from './agent-config-file-io'
import {
  mcpFile,
  primaryFile,
  resolveTarget,
  type McpFile,
  type ResolvedTarget
} from './agent-config-locations'

async function resolve(
  connection: MachineConnection,
  target: AgentConfigTarget
): Promise<ResolvedTarget> {
  return resolveTarget(target, await connection.files.homeDir())
}

function parse(format: 'json' | 'toml', path: string, content: string): Record<string, unknown> {
  const parsed = format === 'toml' ? parseTomlObject(content) : parseJsonObject(content)
  if (!parsed.ok) {
    throw new Error(
      `${path} is not valid ${format.toUpperCase()} (${parsed.error}); fix it in the raw editor first`
    )
  }
  return parsed.value
}

/** Reads the file fresh, applies edits to just those keys, and writes it back with a backup. */
async function editFile(
  connection: MachineConnection,
  path: string,
  format: 'json' | 'toml',
  edits: (config: Record<string, unknown>) => readonly McpEdit[],
  options: { private: boolean }
): Promise<AgentConfigWriteResult> {
  const file = await readConfigFile(connection, path)
  const changes = edits(parse(format, path, file.content))
  const next =
    format === 'toml'
      ? editTomlText(
          file.content,
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: server edits hold strings, booleans, string lists and string maps, all of which TOML can hold.
          changes as AgentConfigTomlEdit[]
        )
      : editJsonText(file.content, changes)
  return writeConfigFile(connection, path, next, {
    expectedHash: file.hash,
    private: options.private
  })
}

function requireMcpFile(resolved: ResolvedTarget, scope: AgentConfigScope): McpFile {
  const file = mcpFile(resolved, scope)
  if (!file) {
    throw new Error(`${resolved.layout.label} keeps no MCP servers in the ${scope} scope`)
  }
  return file
}

export async function saveMcpServer(
  connection: MachineConnection,
  args: {
    target: AgentConfigTarget
    scope: AgentConfigScope
    /** The server being edited; absent when adding one. */
    originalName?: string
    draft: AgentConfigMcpDraft
  }
): Promise<AgentConfigWriteResult> {
  const { location, format } = requireMcpFile(await resolve(connection, args.target), args.scope)
  return editFile(
    connection,
    location.sourcePath,
    format,
    (config) => mcpSaveEdits(config, location, args.draft, args.originalName),
    // Project files are checked in; the others hold this account's tokens.
    { private: args.scope !== 'project' }
  )
}

export async function removeMcpServer(
  connection: MachineConnection,
  args: { target: AgentConfigTarget; scope: AgentConfigScope; name: string }
): Promise<AgentConfigWriteResult> {
  const { location, format } = requireMcpFile(await resolve(connection, args.target), args.scope)
  return editFile(
    connection,
    location.sourcePath,
    format,
    (config) => {
      if (!rawMcpEntry(config, location, args.name)) {
        throw new Error(`"${args.name}" is not in ${location.sourcePath} any more`)
      }
      return [{ path: [...location.serversPath, args.name], remove: true }]
    },
    { private: args.scope !== 'project' }
  )
}

async function storedEntry(
  connection: MachineConnection,
  file: McpFile,
  name: string
): Promise<{ config: Record<string, unknown>; entry: Record<string, unknown> }> {
  const { location, format } = file
  const read = await readConfigFile(connection, location.sourcePath)
  const config = parse(format, location.sourcePath, read.content)
  const entry = rawMcpEntry(config, location, name)
  if (!entry) {
    throw new Error(`"${name}" is not in ${location.sourcePath} any more`)
  }
  return { config, entry }
}

/** The server with its secrets, for the form's "show" button; the only call that returns them. */
export async function revealMcpServer(
  connection: MachineConnection,
  args: { target: AgentConfigTarget; scope: AgentConfigScope; name: string }
): Promise<AgentConfigMcpServer> {
  const file = requireMcpFile(await resolve(connection, args.target), args.scope)
  const { config } = await storedEntry(connection, file, args.name)
  const server = listMcpServers(config, file.location, { reveal: true }).find(
    (candidate) => candidate.name === args.name
  )
  if (!server) {
    throw new Error(`"${args.name}" is not in ${file.location.sourcePath} any more`)
  }
  return server
}

/** Copies a server, secrets included, straight between the two machines' files. */
export async function copyMcpServer(
  source: MachineConnection,
  destination: MachineConnection,
  args: {
    target: AgentConfigTarget
    scope: AgentConfigScope
    name: string
    to: AgentConfigTarget
    toScope: AgentConfigScope
    overwrite?: boolean
  }
): Promise<AgentConfigWriteResult> {
  const from = requireMcpFile(await resolve(source, args.target), args.scope)
  const to = requireMcpFile(await resolve(destination, args.to), args.toScope)
  const { entry } = await storedEntry(source, from, args.name)
  const converted = convertMcpEntry(entry, from.location.codec, to.location.codec)
  return editFile(
    destination,
    to.location.sourcePath,
    to.format,
    (config) => {
      if (rawMcpEntry(config, to.location, args.name) && !args.overwrite) {
        throw new Error(`A server named "${args.name}" already exists there`)
      }
      return [{ path: [...to.location.serversPath, args.name], value: converted }]
    },
    { private: args.toScope !== 'project' }
  )
}

function requirePrimary(
  resolved: ResolvedTarget,
  scope: AgentConfigScope
): NonNullable<ReturnType<typeof primaryFile>> {
  const primary = primaryFile(resolved, scope)
  if (!primary) {
    throw new Error(`${resolved.layout.label} has no settings file in the ${scope} scope`)
  }
  return primary
}

/** Sets or removes keys of the agent's settings file; every other key stays as written. */
export async function patchSettings(
  connection: MachineConnection,
  args: { target: AgentConfigTarget; scope: AgentConfigScope; edits: AgentConfigSettingsEdit[] }
): Promise<AgentConfigWriteResult> {
  if (args.edits.some((edit) => 'value' in edit && hasMask(edit.value))) {
    throw new Error('A hidden value was sent back unchanged; enter the real value to change it')
  }
  const primary = requirePrimary(await resolve(connection, args.target), args.scope)
  return editFile(
    connection,
    primary.path,
    primary.spec.format === 'toml' ? 'toml' : 'json',
    () => args.edits,
    { private: args.scope !== 'project' }
  )
}

/** Claude Code asks before using a project's `.mcp.json` servers; this records the answer. */
export async function setMcpActivation(
  connection: MachineConnection,
  args: { target: AgentConfigTarget; name: string; activation: AgentConfigMcpActivation }
): Promise<AgentConfigWriteResult> {
  const resolved = await resolve(connection, args.target)
  if (resolved.layout.id !== 'claude') {
    throw new Error(`${resolved.layout.label} does not ask before using project servers`)
  }
  const primary = requirePrimary(resolved, 'local')
  return editFile(
    connection,
    primary.path,
    'json',
    (config) => {
      const without = (key: string): string[] =>
        stringList(config[key]).filter((name) => name !== args.name)
      const enabled = without('enabledMcpjsonServers')
      const disabled = without('disabledMcpjsonServers')
      if (args.activation === 'approved') {
        enabled.push(args.name)
      } else if (args.activation === 'disabled') {
        disabled.push(args.name)
      }
      return [
        { path: ['enabledMcpjsonServers'], value: enabled },
        { path: ['disabledMcpjsonServers'], value: disabled }
      ]
    },
    { private: true }
  )
}
