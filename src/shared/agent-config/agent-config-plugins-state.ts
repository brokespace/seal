import type {
  AgentConfigMarketplace,
  AgentConfigPlugin,
  AgentConfigPluginInstall,
  AgentConfigPluginsState,
  AgentConfigScope
} from './agent-config-types'
import { isPlainObject } from './agent-config-values'

export type PluginsStateInput = {
  /** Parsed `~/.claude/plugins/installed_plugins.json`. */
  installed: unknown
  /** Parsed `~/.claude/plugins/known_marketplaces.json`. */
  marketplaces: unknown
  /** Parsed `.claude-plugin/marketplace.json` of each marketplace, by marketplace name. */
  manifests: Record<string, unknown>
  /** Each scope's parsed settings file. */
  settings: { scope: AgentConfigScope; value: Record<string, unknown> | null }[]
  projectPath?: string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function scopeOf(value: unknown): AgentConfigScope {
  return value === 'project' || value === 'local' ? value : 'user'
}

function installsOf(record: unknown): AgentConfigPluginInstall[] {
  // Version 1 kept one install per plugin; version 2 keeps one per scope.
  const list = Array.isArray(record) ? record : isPlainObject(record) ? [record] : []
  return list.filter(isPlainObject).map((install) => ({
    scope: scopeOf(install.scope),
    version: text(install.version) || null,
    installPath: text(install.installPath),
    ...(text(install.projectPath) ? { projectPath: text(install.projectPath) } : {}),
    ...(text(install.lastUpdated) ? { lastUpdated: text(install.lastUpdated) } : {})
  }))
}

function sourceText(source: unknown): string {
  if (typeof source === 'string') {
    return source
  }
  if (!isPlainObject(source)) {
    return ''
  }
  return text(source.repo) || text(source.url) || text(source.path)
}

function splitId(id: string): { name: string; marketplace: string } {
  const at = id.lastIndexOf('@')
  return at > 0
    ? { name: id.slice(0, at), marketplace: id.slice(at + 1) }
    : { name: id, marketplace: '' }
}

const SCOPES: readonly AgentConfigScope[] = ['user', 'project', 'local']

/** Installed plugins, marketplaces, and where each plugin is switched on, the way `claude plugin` sees it. */
export function buildPluginsState(input: PluginsStateInput): AgentConfigPluginsState {
  const installedMap =
    isPlainObject(input.installed) && isPlainObject(input.installed.plugins)
      ? input.installed.plugins
      : {}
  const enabledByScope = new Map<AgentConfigScope, Record<string, unknown>>()
  for (const layer of input.settings) {
    const enabled = layer.value?.enabledPlugins
    if (isPlainObject(enabled)) {
      enabledByScope.set(layer.scope, enabled)
    }
  }
  const descriptions = new Map<string, string>()
  const marketplaces: AgentConfigMarketplace[] = Object.entries(
    isPlainObject(input.marketplaces) ? input.marketplaces : {}
  ).map(([name, raw]) => {
    const record = isPlainObject(raw) ? raw : {}
    const manifest = input.manifests[name]
    const listed =
      isPlainObject(manifest) && Array.isArray(manifest.plugins) ? manifest.plugins : []
    const plugins = listed.filter(isPlainObject).map((plugin) => {
      const pluginName = text(plugin.name)
      descriptions.set(`${pluginName}@${name}`, text(plugin.description))
      return {
        name: pluginName,
        description: text(plugin.description),
        version: text(plugin.version) || null,
        installed: Object.hasOwn(installedMap, `${pluginName}@${name}`)
      }
    })
    return {
      name,
      source: sourceText(record.source),
      installLocation: text(record.installLocation),
      ...(text(record.lastUpdated) ? { lastUpdated: text(record.lastUpdated) } : {}),
      plugins,
      ...(manifest === undefined ? { error: 'Its plugin list could not be read' } : {})
    }
  })

  const ids = new Set([
    ...Object.keys(installedMap),
    ...[...enabledByScope.values()].flatMap((enabled) => Object.keys(enabled))
  ])
  const plugins = [...ids].toSorted().map((id): AgentConfigPlugin => {
    const enabledIn: AgentConfigPlugin['enabledIn'] = {}
    let enabledBy: AgentConfigScope | null = null
    for (const scope of SCOPES) {
      const value = enabledByScope.get(scope)?.[id]
      if (typeof value === 'boolean') {
        enabledIn[scope] = value
        enabledBy = scope
      }
    }
    const installs = installsOf(installedMap[id]).filter(
      (install) =>
        install.scope === 'user' || !input.projectPath || install.projectPath === input.projectPath
    )
    return {
      id,
      ...splitId(id),
      description: descriptions.get(id) ?? '',
      installs,
      enabledIn,
      enabled: enabledBy ? enabledIn[enabledBy] === true : false,
      enabledBy
    }
  })
  return { plugins, marketplaces }
}
