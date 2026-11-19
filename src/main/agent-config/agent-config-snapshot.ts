import { effectiveConfig } from '../../shared/agent-config/agent-config-effective'
import type { AgentConfigCollection } from '../../shared/agent-config/agent-config-layout-types'
import {
  listMcpServers,
  markShadowedServers
} from '../../shared/agent-config/agent-config-mcp-servers'
import { maskConfigValue } from '../../shared/agent-config/agent-config-secrets'
import {
  AGENT_PLUGIN_LEDGER_PATH,
  parseAgentPluginLedger
} from '../../shared/agent-plugins/agent-plugin-ledger'
import { isSkillSwitchedOff } from '../../shared/agent-config/agent-config-skill-switches'
import type {
  AgentConfigDocRef,
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
import {
  MACHINE_SCAN_MAX_TREE_FILES,
  scanMachineFilesInFull,
  type MachineFileScanRecord
} from '../machines/scan/machine-file-scan'
import {
  bundledSkillFromRecord,
  docFromRecord,
  instructionsFromRecord
} from './agent-config-doc-refs'
import { scanRunner } from './agent-config-file-io'
import { withAgentPluginOrigin, withAgentPluginServers } from './agent-config-plugin-origins'
import {
  isInside,
  joinRelative,
  mcpFiles,
  primaryFile,
  resolveTarget,
  scopeRoot,
  type ResolvedTarget
} from './agent-config-locations'
import { readPluginSkills } from './agent-config-plugin-skills-read'
import { readPluginsState } from './agent-config-plugins-read'
import { SCAN_HEAD_BYTES, scanPlan, type ScanPlan } from './agent-config-scan-plan'
import { ConfigTexts, parseConfig, type ParsedConfig } from './agent-config-scanned-config'

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

/** Codex, the agent that reads grouped skills, skips folders whose name starts with a dot. */
function isInHiddenSkillGroup(path: string, collection: AgentConfigCollection): boolean {
  if (collection.shape !== 'skill-folders' || !collection.recursive) {
    return false
  }
  const normalized = path.replaceAll('\\', '/')
  const start = normalized.indexOf(`/${collection.dir}/`)
  return (
    start !== -1 &&
    normalized
      .slice(start + collection.dir.length + 2)
      .split('/')
      .some((folder) => folder.startsWith('.'))
  )
}

/** Everything Settings shows for one agent on one machine, or for one project of it. */
export async function buildAgentConfigSnapshot(
  connection: MachineConnection,
  target: AgentConfigTarget
): Promise<AgentConfigSnapshot> {
  const draft = resolveTarget(target, '~')
  const { request, collections, builtinSkillDirs, instructions, files } = scanPlan(draft)
  const scan = await scanMachineFilesInFull(await scanRunner(connection), request)
  const resolved = resolveTarget(target, scan.home)
  const { layout, projectRoot } = resolved
  const texts = new ConfigTexts(connection, scan.records)
  const warnings: string[] = []
  if (projectRoot && !scan.dirs.some((dir) => dir.tag === 'project')) {
    warnings.push(
      `The project folder ${projectRoot} is not on this machine any more. Creating a file here makes the folder again.`
    )
  }
  const tagged = (tag: string): MachineFileScanRecord[] =>
    scan.records.filter((record) => record.tag === tag)

  const builtinRoots = builtinSkillDirs.map((dir) => joinRelative(scan.home, dir))
  const ownDocs = [
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
      tagged(`c${index}`)
        // The agent's own skills can sit inside the account's folder; they are listed apart.
        .filter(
          (record) =>
            !builtinRoots.some((root) => isInside(root, record.path)) &&
            !isInHiddenSkillGroup(record.path, item.collection)
        )
        .map((record) => docFromRecord(record, item.scope, item.collection, scan.headBytes))
    ),
    ...builtinRoots.flatMap((_root, index) =>
      tagged(`b${index}`).map((record) =>
        bundledSkillFromRecord(record, { kind: 'builtin' }, scan.headBytes)
      )
    )
  ]

  const parsedByPath = new Map<string, ParsedConfig>()
  const parsedAt = async (path: string): Promise<ParsedConfig> => {
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
  const ledger = parseAgentPluginLedger(
    (await parsedAt(joinRelative(scan.home, AGENT_PLUGIN_LEDGER_PATH))).value
  )
  const mcp = withAgentPluginServers(
    markShadowedServers(servers).map((server) =>
      layout.id === 'claude' && server.scope === 'project'
        ? {
            ...server,
            activation: activationOf(server.name, [
              ...rawSettings.map((layer) => layer.value),
              isPlainObject(projectChoices) ? projectChoices : null
            ])
          }
        : server
    ),
    ledger,
    layout.id,
    Boolean(projectRoot)
  )

  const claudePlugins = layout.features.plugins
    ? await readPluginsState(connection, scan.home, parsedAt, rawSettings, projectRoot)
    : null
  const pluginSkills = await readPluginSkills(
    connection,
    resolved,
    {
      claude: claudePlugins,
      userSettings: rawSettings.find((layer) => layer.scope === 'user')?.value ?? null
    },
    SCAN_HEAD_BYTES
  ).catch((error: unknown) => {
    warnings.push(
      `Plugin skills could not be listed: ${error instanceof Error ? error.message : String(error)}`
    )
    return { skills: [], complete: true, cappedFolders: [] }
  })
  const cappedFolders = [
    ...[...(request.skillRoots ?? []), ...(request.trees ?? [])]
      .filter((folder) => scan.capped.includes(folder.tag))
      .map((folder) => folder.dir),
    ...pluginSkills.cappedFolders
  ]
  for (const folder of cappedFolders) {
    warnings.push(
      `Only the first ${MACHINE_SCAN_MAX_TREE_FILES} entries found in ${folder} are listed.`
    )
  }
  if (!scan.complete || !pluginSkills.complete) {
    warnings.push(
      'This machine has more files here than one answer can carry, so some of the list is missing.'
    )
  }
  const settingsLayers = rawSettings.map((layer) => layer.value)
  const docs = [
    ...ownDocs.map((doc) => withAgentPluginOrigin(doc, ledger)),
    ...pluginSkills.skills
  ].map((doc): AgentConfigDocRef =>
    doc.kind === 'skill' &&
    // Claude Code's overrides name the account's and project's skills, not a plugin's.
    !(layout.skills.switch === 'claude-overrides' && doc.bundle) &&
    isSkillSwitchedOff(layout.skills.switch, settingsLayers, doc)
      ? { ...doc, disabled: true }
      : doc
  )

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
    plugins: claudePlugins?.state ?? null,
    effective: effectiveConfig(settings, { mergeLists: layout.id === 'claude' }),
    warnings
  }
}

function layoutPath(resolved: ResolvedTarget, file: ScanPlan['files'][number]): string {
  const specs = file.scope === 'user' ? resolved.layout.user.files : resolved.layout.project.files
  return specs.find((spec) => spec.id === file.id)?.path ?? ''
}
