import { effectiveConfig } from '../../shared/agent-config/agent-config-effective'
import { parseJsonObject } from '../../shared/agent-config/agent-config-json-edit'
import {
  listMcpServers,
  markShadowedServers
} from '../../shared/agent-config/agent-config-mcp-servers'
import { maskConfigValue } from '../../shared/agent-config/agent-config-secrets'
import { parseTomlObject } from '../../shared/agent-config/agent-config-toml-edit'
import type {
  AgentConfigFileRef,
  AgentConfigMcpServer,
  AgentConfigSettingsLayer,
  AgentConfigSnapshot,
  AgentConfigTarget
} from '../../shared/agent-config/agent-config-types'
import {
  isPlainObject,
  stringList,
  valueAtPath
} from '../../shared/agent-config/agent-config-values'
import type { MachineConnection } from '../machines/connection/machine-connection'
import { scanMachineFiles, type MachineFileScanRecord } from '../machines/scan/machine-file-scan'
import { docFromRecord, instructionsFromRecord } from './agent-config-doc-refs'
import { scanRunner } from './agent-config-file-io'
import {
  joinRelative,
  mcpFiles,
  primaryFile,
  resolveTarget,
  scopeRoot,
  type ResolvedTarget
} from './agent-config-locations'
import { readPluginsState } from './agent-config-plugins-read'
import { SCAN_HEAD_BYTES, scanPlan, type ScanPlan } from './agent-config-scan-plan'

const MAX_CONFIG_BYTES = 48 * 1024 * 1024

type Parsed = { value: Record<string, unknown> | null; error?: string; exists: boolean }

function parseConfig(path: string, text: string | null): Parsed {
  if (text === null) {
    return { value: null, exists: false }
  }
  const parsed = path.endsWith('.toml') ? parseTomlObject(text) : parseJsonObject(text)
  return parsed.ok
    ? { value: parsed.value, exists: true }
    : { value: null, error: parsed.error, exists: true }
}

function withoutPath(
  value: Record<string, unknown>,
  path: readonly string[]
): Record<string, unknown> {
  const [key, ...rest] = path
  if (key === undefined || !Object.hasOwn(value, key)) {
    return value
  }
  const { [key]: child, ...others } = value
  return rest.length > 0 && isPlainObject(child)
    ? { ...others, [key]: withoutPath(child, rest) }
    : others
}

/** Reads whole files in as few round trips as possible: small ones already came with the scan. */
class ConfigTexts {
  private readonly cache = new Map<string, Promise<string | null>>()

  constructor(
    private readonly connection: MachineConnection,
    private readonly records: readonly MachineFileScanRecord[]
  ) {}

  read(path: string): Promise<string | null> {
    let pending = this.cache.get(path)
    if (!pending) {
      const record = this.records.find((item) => item.path === path)
      pending = !record
        ? Promise.resolve(null)
        : record.bytes <= SCAN_HEAD_BYTES && Buffer.byteLength(record.head) === record.bytes
          ? Promise.resolve(record.head)
          : this.connection.files
              .readFile(path, MAX_CONFIG_BYTES)
              .then((read) => read.data.toString('utf8'))
      this.cache.set(path, pending)
    }
    return pending
  }
}

function activationOf(
  name: string,
  layers: readonly (Record<string, unknown> | null)[]
): AgentConfigMcpServer['activation'] {
  if (layers.some((layer) => stringList(layer?.disabledMcpjsonServers).includes(name))) {
    return 'disabled'
  }
  const approved = layers.some(
    (layer) =>
      layer?.enableAllProjectMcpServers === true ||
      stringList(layer?.enabledMcpjsonServers).includes(name)
  )
  return approved ? 'approved' : 'pending'
}

/** Everything Settings shows for one agent on one machine, or for one project of it. */
export async function buildAgentConfigSnapshot(
  connection: MachineConnection,
  target: AgentConfigTarget
): Promise<AgentConfigSnapshot> {
  const draft = resolveTarget(target, '~')
  const { request, collections, instructions, files } = scanPlan(draft)
  const scan = await scanMachineFiles(await scanRunner(connection), request)
  const resolved = resolveTarget(target, scan.home)
  const { layout, projectRoot } = resolved
  const texts = new ConfigTexts(connection, scan.records)
  const warnings: string[] = []
  const tagged = (tag: string): MachineFileScanRecord[] =>
    scan.records.filter((record) => record.tag === tag)

  const docs = [
    ...instructions.flatMap((item, index) =>
      tagged(`i${index}`).map((record) => instructionsFromRecord(record, item.scope, projectRoot))
    ),
    ...tagged('n')
      .filter(
        (record) =>
          !scan.records.some((other) => other.tag.startsWith('i') && other.path === record.path)
      )
      .map((record) => instructionsFromRecord(record, 'project', projectRoot)),
    ...collections.flatMap((item, index) =>
      tagged(`c${index}`).map((record) =>
        docFromRecord(record, item.scope, item.collection, SCAN_HEAD_BYTES)
      )
    )
  ]

  const parsedByPath = new Map<string, Parsed>()
  const parsedAt = async (path: string): Promise<Parsed> => {
    const known = parsedByPath.get(path)
    if (known) {
      return known
    }
    const text = await texts.read(path).catch((error: unknown) => {
      warnings.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    })
    const parsed = parseConfig(path, text)
    if (parsed.error) {
      warnings.push(`${path} could not be read: ${parsed.error}`)
    }
    parsedByPath.set(path, parsed)
    return parsed
  }

  const fileRefs = await Promise.all(
    files.map(async (file, index): Promise<AgentConfigFileRef> => {
      const record = tagged(`f${index}`)[0]
      const path =
        record?.path ?? joinRelative(scopeRoot(resolved, file.scope), layoutPath(resolved, file))
      const parsed = record && file.format !== 'markdown' ? await parsedAt(path) : null
      return {
        id: file.id,
        label: path.split(/[\\/]/).at(-1) ?? path,
        scope: file.scope,
        path,
        format: file.format,
        exists: Boolean(record),
        bytes: record?.bytes ?? 0,
        ...(parsed?.error ? { error: parsed.error } : {})
      }
    })
  )

  const mcpSources = mcpFiles(resolved)
  const settings = await Promise.all(
    (['user', 'project', 'local'] as const)
      .flatMap((scope) => {
        const primary = primaryFile(resolved, scope)
        return primary ? [{ scope, primary }] : []
      })
      .map(async ({ scope, primary }): Promise<AgentConfigSettingsLayer> => {
        const parsed = await parsedAt(primary.path)
        const ownServers = mcpSources.find(
          (source) => source.location.sourcePath === primary.path && source.location.scope === scope
        )
        const masked = parsed.value
          ? maskConfigValue(
              ownServers ? withoutPath(parsed.value, ownServers.location.serversPath) : parsed.value
            )
          : null
        return {
          scope,
          path: primary.path,
          format: primary.spec.format === 'toml' ? 'toml' : 'json',
          exists: parsed.exists,
          ...(parsed.error ? { error: parsed.error } : {}),
          value: masked && isPlainObject(masked.value) ? masked.value : null,
          maskedPaths: masked?.maskedPaths ?? []
        }
      })
  )

  const rawSettings = await Promise.all(
    settings.map(async (layer) => ({
      scope: layer.scope,
      value: (await parsedAt(layer.path)).value
    }))
  )
  const servers = (
    await Promise.all(
      mcpSources.map(async ({ location }) =>
        listMcpServers((await parsedAt(location.sourcePath)).value, location)
      )
    )
  ).flat()
  const claudeJson =
    layout.id === 'claude' ? (await parsedAt(joinRelative(scan.home, '.claude.json'))).value : null
  const projectChoices = projectRoot
    ? valueAtPath(claudeJson, ['projects', projectRoot])
    : undefined
  const mcp = markShadowedServers(servers).map((server) =>
    layout.id === 'claude' && server.scope === 'project'
      ? {
          ...server,
          activation: activationOf(server.name, [
            ...rawSettings.map((layer) => layer.value),
            isPlainObject(projectChoices) ? projectChoices : null
          ])
        }
      : server
  )

  const plugins = layout.features.plugins
    ? await readPluginsState(connection, scan.home, parsedAt, rawSettings, projectRoot)
    : null

  return {
    target,
    homeDir: scan.home,
    agentDir:
      scan.dirs.find((dir) => dir.tag === 'agent')?.path ??
      joinRelative(projectRoot ?? scan.home, projectRoot ? layout.project.dir : layout.user.dir),
    cliAvailable: scan.commands.includes(layout.command),
    docs,
    files: fileRefs,
    settings,
    mcp,
    plugins,
    effective: effectiveConfig(settings, { mergeLists: layout.id === 'claude' }),
    warnings
  }
}

function layoutPath(resolved: ResolvedTarget, file: ScanPlan['files'][number]): string {
  const specs = file.scope === 'user' ? resolved.layout.user.files : resolved.layout.project.files
  return specs.find((spec) => spec.id === file.id)?.path ?? ''
}
