import {
  AGENT_CONFIG_NESTED_MAX_DEPTH,
  AGENT_CONFIG_NESTED_SKIP_DIRS,
  AGENT_CONFIG_SKILL_MAX_DEPTH
} from '../../shared/agent-config/agent-config-scan-limits'
import type { AgentConfigCollection } from '../../shared/agent-config/agent-config-layout-types'
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
  /** Folders of skills that ship with the agent; scan tag `b<index>`. */
  builtinSkillDirs: string[]
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
  const scopes: ('user' | 'project')[] = projectRoot ? ['user', 'project'] : ['user']
  const homeScope = projectRoot ? 'project' : 'user'
  const collections: ScanPlan['collections'] = []
  const instructions: ScanPlan['instructions'] = []
  const files: ScanPlan['files'] = []
  const placeIn = (scope: 'user' | 'project'): ((relative: string) => string) => {
    const root = scope === 'user' ? '~' : scopeRoot(resolved, scope)
    return (relative) => (root === '~' ? `~/${relative}` : joinRelative(root, relative))
  }
  // The page's own documents first; a project also runs with the account's skills.
  for (const scope of scopes.toReversed()) {
    const at = placeIn(scope)
    for (const collection of (scope === 'user' ? layout.user : layout.project).collections) {
      if (scope === homeScope || collection.kind === 'skill') {
        collections.push({ scope, collection, dir: at(collection.dir) })
      }
    }
  }
  for (const scope of scopes) {
    const at = placeIn(scope)
    const scopeLayout = scope === 'user' ? layout.user : layout.project
    for (const file of scopeLayout.files) {
      files.push({
        scope: file.local ? 'local' : scope,
        id: file.id,
        path: at(file.path),
        format: file.format
      })
    }
    // A project page lists the project's own instructions; the machine page lists the account's.
    if (scope !== homeScope) {
      continue
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
    skillRoots: [
      ...collections.flatMap((item, index) =>
        item.collection.shape === 'skill-folders'
          ? [
              {
                tag: `c${index}`,
                dir: item.dir,
                maxDepth: item.collection.recursive ? AGENT_CONFIG_SKILL_MAX_DEPTH : 1
              }
            ]
          : []
      ),
      ...layout.skills.builtinDirs.map((dir, index) => ({ tag: `b${index}`, dir: `~/${dir}` }))
    ],
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
  return { request, collections, builtinSkillDirs: layout.skills.builtinDirs, instructions, files }
}
