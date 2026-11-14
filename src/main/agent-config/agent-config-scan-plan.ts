import {
  AGENT_CONFIG_NESTED_MAX_DEPTH,
  AGENT_CONFIG_NESTED_SKIP_DIRS,
  type AgentConfigCollection
} from '../../shared/agent-config/agent-config-catalog'
import type {
  AgentConfigFileRef,
  AgentConfigScope
} from '../../shared/agent-config/agent-config-types'
import type { MachineFileScanRequest } from '../machines/scan/machine-file-scan'
import { joinRelative, scopeRoot, type ResolvedTarget } from './agent-config-locations'

/** How much of each file the scan returns; small config files arrive whole. */
export const SCAN_HEAD_BYTES = 4_096

/** What to look for, and what each scan tag stands for. */
export type ScanPlan = {
  request: MachineFileScanRequest
  collections: { scope: AgentConfigScope; collection: AgentConfigCollection; dir: string }[]
  instructions: { scope: AgentConfigScope; path: string }[]
  files: {
    scope: AgentConfigScope
    id: string
    path: string
    format: AgentConfigFileRef['format']
  }[]
}

export function scanPlan(resolved: ResolvedTarget): ScanPlan {
  const { layout, projectRoot } = resolved
  const scopes: AgentConfigScope[] = projectRoot ? ['user', 'project'] : ['user']
  const collections: ScanPlan['collections'] = []
  const instructions: ScanPlan['instructions'] = []
  const files: ScanPlan['files'] = []
  for (const scope of scopes) {
    const root = scope === 'user' ? '~' : scopeRoot(resolved, scope)
    const at = (relative: string): string =>
      root === '~' ? `~/${relative}` : joinRelative(root, relative)
    const scopeLayout = scope === 'user' ? layout.user : layout.project
    for (const file of scopeLayout.files) {
      files.push({
        scope: file.local ? 'local' : scope,
        id: file.id,
        path: at(file.path),
        format: file.format
      })
    }
    // A project page lists the project's own documents; the machine page lists the account's.
    if ((scope === 'project') !== (projectRoot !== null)) {
      continue
    }
    for (const collection of scopeLayout.collections) {
      collections.push({ scope, collection, dir: at(collection.dir) })
    }
    for (const relative of scopeLayout.instructions) {
      instructions.push({ scope, path: at(relative) })
    }
    if (scope === 'project') {
      for (const relative of layout.project.localInstructions) {
        instructions.push({ scope: 'local', path: at(relative) })
      }
    }
  }
  const claudeExtras = layout.features.plugins
    ? ['installed_plugins.json', 'known_marketplaces.json'].map((name) => ({
        tag: 'x',
        path: `~/.claude/plugins/${name}`
      }))
    : []
  const request: MachineFileScanRequest = {
    commands: [layout.command],
    dirs: [
      {
        tag: 'agent',
        path: projectRoot ? joinRelative(projectRoot, layout.project.dir) : `~/${layout.user.dir}`
      }
    ],
    skillRoots: collections.flatMap((item, index) =>
      item.collection.shape === 'skill-folders' ? [{ tag: `c${index}`, dir: item.dir }] : []
    ),
    trees: collections.flatMap((item, index) =>
      item.collection.shape === 'files'
        ? [
            {
              tag: `c${index}`,
              dir: item.dir,
              extension: item.collection.extension,
              recursive: item.collection.recursive
            }
          ]
        : []
    ),
    named:
      projectRoot && layout.project.nestedInstructions.length > 0
        ? [
            {
              tag: 'n',
              root: projectRoot,
              names: layout.project.nestedInstructions,
              maxDepth: AGENT_CONFIG_NESTED_MAX_DEPTH,
              skipDirs: AGENT_CONFIG_NESTED_SKIP_DIRS
            }
          ]
        : [],
    files: [
      ...instructions.map((item, index) => ({ tag: `i${index}`, path: item.path })),
      ...files.map((item, index) => ({ tag: `f${index}`, path: item.path })),
      ...claudeExtras
    ],
    headBytes: SCAN_HEAD_BYTES
  }
  return { request, collections, instructions, files }
}
