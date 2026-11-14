import type {
  AgentConfigCollection,
  AgentConfigLayout
} from '../../../../../shared/agent-config/agent-config-layout-types'
import type {
  AgentConfigDocRef,
  AgentConfigSkillBundle
} from '../../../../../shared/agent-config/agent-config-types'

export type AgentConfigSkillGroup = { key: string; docs: AgentConfigDocRef[] } & (
  | { source: 'folder'; scope: 'user' | 'project'; collection: AgentConfigCollection }
  | { source: 'plugin'; plugin: Extract<AgentConfigSkillBundle, { kind: 'plugin' }> }
  | { source: 'builtin' }
)

function isInFolder(doc: AgentConfigDocRef, dir: string): boolean {
  return doc.path.replaceAll('\\', '/').includes(`/${dir}/`)
}

/**
 * Skills by where they come from: the page's own folders, then the account's on a project
 * page, then each plugin, then the ones that ship with the agent.
 */
export function agentConfigSkillGroups(
  layout: AgentConfigLayout,
  homeScope: 'user' | 'project',
  docs: readonly AgentConfigDocRef[]
): AgentConfigSkillGroup[] {
  const skills = docs.filter((doc) => doc.kind === 'skill')
  const scopes: ('user' | 'project')[] = homeScope === 'project' ? ['project', 'user'] : ['user']
  const folders = scopes.flatMap((scope) =>
    (scope === 'user' ? layout.user : layout.project).collections
      .filter((collection) => collection.kind === 'skill')
      .map((collection): AgentConfigSkillGroup => ({
        key: `${scope}:${collection.dir}`,
        source: 'folder',
        scope,
        collection,
        docs: skills.filter(
          (doc) => !doc.bundle && doc.scope === scope && isInFolder(doc, collection.dir)
        )
      }))
      // A folder the page cannot add to, or that belongs to another agent, is noise while empty.
      .filter(
        (group) =>
          group.docs.length > 0 ||
          (scope === homeScope && group.source === 'folder' && !group.collection.shared)
      )
  )
  const plugins = new Map<string, AgentConfigSkillGroup>()
  for (const doc of skills) {
    if (doc.bundle?.kind === 'plugin') {
      const key = `plugin:${doc.bundle.id}:${doc.bundle.version ?? ''}`
      const group = plugins.get(key) ?? { key, source: 'plugin', plugin: doc.bundle, docs: [] }
      group.docs.push(doc)
      plugins.set(key, group)
    }
  }
  const builtin = skills.filter((doc) => doc.bundle?.kind === 'builtin')
  return [
    ...folders,
    ...plugins.values(),
    ...(builtin.length > 0
      ? [{ key: 'builtin', source: 'builtin', docs: builtin } satisfies AgentConfigSkillGroup]
      : [])
  ]
}

/** A document's place as people write it: `~/…` in the account, relative inside the project. */
export function agentConfigShortPath(
  path: string,
  homeDir: string,
  projectPath: string | undefined
): string {
  const normalized = path.replaceAll('\\', '/')
  const under = (root: string | undefined): string | null => {
    const prefix = root ? `${root.replaceAll('\\', '/').replace(/\/+$/, '')}/` : null
    return prefix && normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null
  }
  const inProject = under(projectPath)
  if (inProject !== null) {
    return inProject
  }
  const inHome = under(homeDir)
  return inHome === null ? path : `~/${inHome}`
}
