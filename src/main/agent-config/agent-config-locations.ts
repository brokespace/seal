import {
  agentConfigLayout,
  type AgentConfigFileSpec,
  type AgentConfigLayout,
  type AgentConfigScopeLayout
} from '../../shared/agent-config/agent-config-catalog'
import type { McpServersLocation } from '../../shared/agent-config/agent-config-mcp-servers'
import type {
  AgentConfigScope,
  AgentConfigTarget
} from '../../shared/agent-config/agent-config-types'
import { joinMachinePath, machinePathStyle } from '../../shared/machines/machine-paths'
import { backupRoot } from './agent-config-backups'

/** A target with the folders it stands for on its machine. */
export type ResolvedTarget = {
  target: AgentConfigTarget
  layout: AgentConfigLayout
  home: string
  /** Absolute project root, without a trailing separator. */
  projectRoot: string | null
}

export function resolveTarget(target: AgentConfigTarget, home: string): ResolvedTarget {
  const project = target.projectPath?.replace(/[\\/]+$/, '') || null
  if (project !== null && !/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(project)) {
    throw new Error('A project needs an absolute path')
  }
  return { target, layout: agentConfigLayout(target.agent), home, projectRoot: project }
}

/** Joins a `/`-separated path from the catalog onto a folder of the machine. */
export function joinRelative(root: string, relative: string): string {
  return relative.split('/').filter(Boolean).reduce(joinMachinePath, root)
}

export function scopeLayout(
  resolved: ResolvedTarget,
  scope: AgentConfigScope
): AgentConfigScopeLayout {
  return scope === 'user' ? resolved.layout.user : resolved.layout.project
}

export function scopeRoot(resolved: ResolvedTarget, scope: AgentConfigScope): string {
  if (scope === 'user') {
    return resolved.home
  }
  if (!resolved.projectRoot) {
    throw new Error('This needs a project')
  }
  return resolved.projectRoot
}

const PRIMARY_FILE_IDS = ['settings', 'config']

/** The agent's main settings file in a scope, if it has one there. */
export function primaryFile(
  resolved: ResolvedTarget,
  scope: AgentConfigScope
): { spec: AgentConfigFileSpec; path: string } | null {
  const id = resolved.layout.user.files.find((file) => PRIMARY_FILE_IDS.includes(file.id))?.id
  if (!id || (scope !== 'user' && !resolved.projectRoot)) {
    return null
  }
  const files = scopeLayout(resolved, scope).files
  const spec =
    scope === 'local'
      ? files.find((file) => file.local && file.id.startsWith(id))
      : files.find((file) => !file.local && file.id === id)
  return spec ? { spec, path: joinRelative(scopeRoot(resolved, scope), spec.path) } : null
}

export type McpFile = { location: McpServersLocation; format: 'json' | 'toml' }

/** Where this agent keeps MCP servers for a scope; null when it has no such scope. */
export function mcpFile(resolved: ResolvedTarget, scope: AgentConfigScope): McpFile | null {
  const { layout, home, projectRoot } = resolved
  if (scope === 'local') {
    // Claude Code keeps a project's private servers in the home file, under the project's path.
    if (layout.id !== 'claude' || !projectRoot || !layout.user.mcp) {
      return null
    }
    return {
      location: {
        scope,
        sourcePath: joinRelative(home, layout.user.mcp.path),
        codec: layout.user.mcp.codec,
        serversPath: ['projects', projectRoot, 'mcpServers']
      },
      format: 'json'
    }
  }
  const spec = scopeLayout(resolved, scope).mcp
  if (!spec || (scope === 'project' && !projectRoot)) {
    return null
  }
  return {
    location: {
      scope,
      sourcePath: joinRelative(scopeRoot(resolved, scope), spec.path),
      codec: spec.codec,
      serversPath: spec.serversPath
    },
    format: spec.path.endsWith('.toml') ? 'toml' : 'json'
  }
}

export function mcpFiles(resolved: ResolvedTarget): McpFile[] {
  const scopes: AgentConfigScope[] = resolved.projectRoot ? ['user', 'project', 'local'] : ['user']
  return scopes.flatMap((scope) => mcpFile(resolved, scope) ?? [])
}

function isInside(root: string, path: string): boolean {
  const separator = machinePathStyle(root) === 'windows' ? '\\' : '/'
  return path === root || path.startsWith(root.endsWith(separator) ? root : `${root}${separator}`)
}

/**
 * Seal edits agent configuration, not arbitrary files: a path must sit in one of the agent's own
 * folders, in the project, or in the backups folder.
 */
export function assertManagedPath(resolved: ResolvedTarget, path: string): void {
  if (path.split(/[\\/]/).includes('..')) {
    throw new Error('Paths cannot contain ".."')
  }
  const { layout, home, projectRoot } = resolved
  const userRoots = [
    layout.user.dir,
    ...layout.user.instructions,
    ...layout.user.files.map((file) => file.path),
    ...layout.user.collections.map((collection) => collection.dir)
  ].map((relative) => joinRelative(home, relative))
  const roots = [...userRoots, backupRoot(home), ...(projectRoot ? [projectRoot] : [])]
  if (!roots.some((root) => isInside(root, path))) {
    throw new Error(`${path} is not part of ${layout.label}'s configuration`)
  }
}
